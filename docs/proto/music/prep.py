import json, sys, subprocess, array, math, os, shutil
FF, SRC, OUT = sys.argv[1:4]
data = json.load(open('/tmp/musicdata/tracks.json'))
z = sorted(t['zcr'] for t in data)
names = ["Elysium","Blej (Fade Black Remix)","Sunder","Dopamine Hits","Concussion (Mefjus Remix)","Noir","Pure Action","Stargazer","Statues","Hear The Lies [Premiere]"]
by = {t['title']: t for t in data}
out = []
for i, n in enumerate(names):
    t = by[n]; ext = os.path.splitext(t['file'])[1]
    dst = f'{OUT}/audio/{i:02d}{ext}'
    if not os.path.exists(dst): shutil.copy(os.path.join(SRC, t['file']), dst)
    raw = subprocess.run([FF,'-v','error','-i',dst,'-ac','1','-ar','2000','-f','s16le','-'],capture_output=True).stdout
    a = array.array('h'); a.frombytes(raw[:len(raw)//2*2])
    step = 200  # 10 per second
    env = []
    for b in range(0, len(a), step):
        seg = a[b:b+step:2]
        env.append(math.sqrt(sum(x*x for x in seg)/max(len(seg),1)))
    m = sorted(env)[int(len(env)*.98)] or 1
    out.append(dict(src=f'audio/{i:02d}{ext}', title=t['title'], artist=t['artist'] or 'neuro soundcloud', dur=len(a)/2000,
                    hue=round(195 + z.index(t['zcr'])/(len(z)-1)*125), env=[round(min(e/m,1),2) for e in env]))
json.dump(out, open(f'{OUT}/tracks.json','w'))
print(len(out), 'tracks', sum(len(o['env']) for o in out), 'points')
