"""Build ``src/sestudio/music/skey.onnx``: S-KEY's ChromaNet as an ONNX graph.

The same maths as :func:`sestudio.music.keynet.chromanet_numpy`, from the same
``skey.npz`` weights, for ONNX Runtime to run about 3x faster. Needs ``onnx``
(a dev dependency). Run again only if the weights change:

    uv run python scripts/build_skey_onnx.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto
from onnx import helper as h
from onnx import numpy_helper as nh

MUSIC = Path(__file__).resolve().parent.parent / "src" / "sestudio" / "music"


def build(weights: Path) -> onnx.ModelProto:
    w = {k: v.astype(np.float32) for k, v in np.load(weights).items()}
    nodes: list[onnx.NodeProto] = []
    inits: dict[str, onnx.TensorProto] = {}

    def const(name: str, arr) -> str:
        inits.setdefault(name, nh.from_array(np.asarray(arr), name))
        return name

    def op(kind: str, ins: list[str], **attrs) -> str:
        out = f"t{len(nodes)}"
        nodes.append(h.make_node(kind, ins, [out], **attrs))
        return out

    def norm(x: str) -> str:  # layer_norm over the whole (C, H, W), no affine
        mean = op("ReduceMean", [x], axes=[1, 2, 3], keepdims=1)
        d = op("Sub", [x, mean])
        var = op("ReduceMean", [op("Mul", [d, d])], axes=[1, 2, 3], keepdims=1)
        eps = op("Add", [var, const("eps", np.float32(1e-5))])
        return op("Div", [d, op("Sqrt", [eps])])

    def gelu(x: str) -> str:
        e = op("Erf", [op("Mul", [x, const("isqrt2", np.float32(1 / np.sqrt(2)))])])
        half = op("Mul", [x, const("half", np.float32(0.5))])
        return op("Mul", [half, op("Add", [e, const("one", np.float32(1))])])

    x = "spec"  # (1, 1, 84, W)
    for i in range(7):
        d, c = f"time_downsampling_blocks.{i}.conv.", f"convnext_blocks.{i}."
        x = norm(x)
        # Kernel 2, stride 2 drops an odd last frame, as chromanet's truncation does.
        down = [x, const(d + "w", w[d + "weight"]), const(d + "b", w[d + "bias"])]
        x = gelu(op("Conv", down, kernel_shape=[1, 2], strides=[1, 2]))
        dw = w[c + "dwconv.weight"]
        k = dw.shape[-1]
        pads = np.array([0, 0, k // 2, k // 2, 0, 0, k // 2, k // 2], np.int64)
        y = op("Pad", [x, const(c + "pads", pads)], mode="edge")
        y = op(
            "Conv",
            [y, const(c + "dw", dw), const(c + "dwb", w[c + "dwconv.bias"])],
            kernel_shape=[k, k],
            group=dw.shape[0],
        )
        y = norm(y)
        p1 = w[c + "pwconv1.weight"][:, :, None, None]
        y = gelu(
            op(
                "Conv",
                [y, const(c + "p1", p1), const(c + "p1b", w[c + "pwconv1.bias"])],
                kernel_shape=[1, 1],
            )
        )
        gamma = w[c + "gamma"]
        p2 = (w[c + "pwconv2.weight"] * gamma[:, None])[:, :, None, None]
        p2b = w[c + "pwconv2.bias"] * gamma
        y = op(
            "Conv",
            [y, const(c + "p2", p2), const(c + "p2b", p2b)],
            kernel_shape=[1, 1],
        )
        x = op("Add", [x, y])
    # Octave pool, then time: (1, C, 84, W) -> (1, C, 7, 12, W) -> (1, C, 12).
    frames = op(
        "Slice",
        [
            op("Shape", [x]),
            const("three", np.array([3], np.int64)),
            const("four", np.array([4], np.int64)),
        ],
    )
    shape = op(
        "Concat", [const("pre", np.array([1, -1, 7, 12], np.int64)), frames], axis=0
    )
    x = op("ReduceMean", [op("Reshape", [x, shape])], axes=[2, 4], keepdims=0)
    x = op(
        "Conv",
        [
            x,
            const("cw", w["classifier.weight"][:, :, 0]),
            const("cb", w["classifier.bias"]),
        ],
        kernel_shape=[1],
    )  # (1, 2, 12)
    mean = w["batch_norm.running_mean"][None, :, None]
    std = np.sqrt(w["batch_norm.running_var"] + 1e-5)[None, :, None]
    x = op("Div", [op("Sub", [x, const("bnm", mean)]), const("bns", std)])
    flat = const("flat", np.array([24], np.int64))
    nodes.append(h.make_node("Reshape", [x, flat], ["logits"]))
    graph = h.make_graph(
        nodes,
        "skey",
        [h.make_tensor_value_info("spec", TensorProto.FLOAT, [1, 1, 84, "W"])],
        [h.make_tensor_value_info("logits", TensorProto.FLOAT, [24])],
        list(inits.values()),
    )
    model = h.make_model(graph, opset_imports=[h.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


if __name__ == "__main__":
    onnx.save(build(MUSIC / "skey.npz"), MUSIC / "skey.onnx")
