import Layer from './Layer'
import PlayerBar from './PlayerBar'
import { useLayerMounted, useMusicHost } from './player'

/** Everything the music player adds to the app shell: the sound, the bar and the layer. The bar stays under the layer: it grows out of it and shrinks back into it. */
export default function MusicPlayer({ onMusicPage }: { onMusicPage: boolean }) {
  useMusicHost()
  const layer = useLayerMounted()
  return (
    <>
      <PlayerBar onMusicPage={onMusicPage} />
      {layer && <Layer />}
    </>
  )
}
