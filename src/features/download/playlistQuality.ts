import type { PlaylistQuality } from "../../types/domain";

export const DEFAULT_PLAYLIST_QUALITY: PlaylistQuality = {
  maxHeight: null,
  maxVideoBitrateKbps: null,
  maxAudioBitrateKbps: null,
  allowExceed: false,
};
