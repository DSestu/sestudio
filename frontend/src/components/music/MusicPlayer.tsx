import Layer from './Layer'
import PlayerBar from './PlayerBar'
import { useLayerOpen, useMusicHost } from './player'

/** Everything the music player adds to the app shell: the sound, the bar and the layer. */
export default function MusicPlayer({ onMusicPage }: { onMusicPage: boolean }) {
  useMusicHost()
  return useLayerOpen() ? <Layer /> : <PlayerBar onMusicPage={onMusicPage} />
}
