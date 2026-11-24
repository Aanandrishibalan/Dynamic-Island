Put these two things in this folder (they are too large to bundle here):

1. whisper.cpp for Windows (x64): download the release zip from
   https://github.com/ggml-org/whisper.cpp/releases and copy ALL files from it
   here (whisper-cli.exe plus its .dll files; older builds call it main.exe).

2. A model file from https://huggingface.co/ggerganov/whisper.cpp
   - ggml-base.en.bin  (~140 MB, fast, English only)
   - ggml-small.bin    (~470 MB, multilingual incl. Tamil)  <- default
   Then choose the file name in Settings > AI & chat > Whisper model.
