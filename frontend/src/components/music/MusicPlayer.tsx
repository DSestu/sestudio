import Layer from './Layer'
import PlayerBar from './PlayerBar'
import { useLayerOpen, useMusicHost } from './player'

/** Everything the music player adds to the app shell: the sound, the bar and the layer. Lab only. */
export default function MusicPlayer() {
  useMusicHost()
  return useLayerOpen() ? <Layer /> : <PlayerBar />
}
