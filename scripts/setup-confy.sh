cd /content
git clone https://github.com/hmdlohar/web-cmd
git clone https://github.com/comfyanonymous/ComfyUI
git clone https://github.com/ltdrdata/ComfyUI-Manager ComfyUI/custom_nodes/ComfyUI-Manager
git clone https://github.com/slahiri/ComfyUI-Workflow-Models-Downloader.git ComfyUI/custom_nodes/ComfyUI-Workflow-Models-Downloader
git clone https://github.com/city96/ComfyUI-GGUF ComfyUI/custom_nodes/ComfyUI-GGUF
git clone https://github.com/kijai/ComfyUI-WanVideoWrapper.git ComfyUI/custom_nodes/ComfyUI-WanVideoWrapper
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite
git clone https://github.com/kijai/ComfyUI-KJNodes.git ComfyUI/custom_nodes/ComfyUI-KJNodes

python web-cmd/comfy/combine.py
pip install -r ComfyUI/requirements.txt
pip install -r ComfyUI/custom_nodes/combined_requirements.txt


# Flux kelin gguf
# !wget https://huggingface.co/unsloth/FLUX.2-klein-9B-GGUF/resolve/main/flux-2-klein-9b-Q3_K_M.gguf -P /content/ComfyUI/models/unet
wget https://huggingface.co/QuantStack/FLUX.2-Klein-9B-KV-GGUF/resolve/main/Flux-2-Klein-9B-KV-Q3_K_M.gguf -P /content/ComfyUI/models/unet
# !wget https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b_fp4mixed.safetensors -P  /content/ComfyUI/models/text_encoders
wget https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf -P /content/ComfyUI/models/text_encoders
wget https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/vae/flux2-vae.safetensors -P  /content/ComfyUI/models/vae