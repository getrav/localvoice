export interface WhisperModel {
  id: string;
  name: string;
  size: string;
  parameters: string;
  englishOnly: boolean;
  description: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: "Systran/faster-whisper-tiny", name: "Tiny", size: "75 MB", parameters: "39M", englishOnly: false, description: "Fastest, lowest accuracy" },
  { id: "Systran/faster-whisper-tiny.en", name: "Tiny (English)", size: "75 MB", parameters: "39M", englishOnly: true, description: "English-only tiny model" },
  { id: "Systran/faster-whisper-base", name: "Base", size: "142 MB", parameters: "74M", englishOnly: false, description: "Fast with decent accuracy" },
  { id: "Systran/faster-whisper-base.en", name: "Base (English)", size: "142 MB", parameters: "74M", englishOnly: true, description: "English-only base model" },
  { id: "Systran/faster-whisper-small", name: "Small", size: "466 MB", parameters: "244M", englishOnly: false, description: "Good balance of speed and accuracy" },
  { id: "Systran/faster-whisper-small.en", name: "Small (English)", size: "466 MB", parameters: "244M", englishOnly: true, description: "English-only, optimized for English transcription" },
  { id: "Systran/faster-whisper-medium", name: "Medium", size: "1.5 GB", parameters: "769M", englishOnly: false, description: "High accuracy, multilingual support" },
  { id: "Systran/faster-whisper-medium.en", name: "Medium (English)", size: "1.5 GB", parameters: "769M", englishOnly: true, description: "English-only medium model" },
  { id: "Systran/faster-whisper-large-v2", name: "Large v2", size: "2.9 GB", parameters: "1550M", englishOnly: false, description: "Highest accuracy, slowest" },
  { id: "Systran/faster-whisper-large-v3", name: "Large v3", size: "2.9 GB", parameters: "1550M", englishOnly: false, description: "Latest large model" },
];
