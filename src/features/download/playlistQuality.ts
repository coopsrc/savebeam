import type { PlaylistQuality } from "../../types/domain";

export const DEFAULT_PLAYLIST_QUALITY: PlaylistQuality = {
  resolutionHeight: null,
  frameRate: null,
  videoExtension: null,
  videoCodec: null,
  audioExtension: null,
  audioCodec: null,
  maxHeight: null,
  maxVideoBitrateKbps: null,
  maxAudioBitrateKbps: null,
  allowExceed: false,
};
