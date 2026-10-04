# Entrada visual: una foto y una pregunta para el modelo multimodal.
#   python vision.py foto-del-puesto.jpg "¿Qué productos ve y cuáles parecen frescos?"

import base64
import os
import sys

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

path, question = sys.argv[1], sys.argv[2]
image = base64.b64encode(open(path, "rb").read()).decode()
mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"

openai_client = AIProjectClient(endpoint=os.environ["PROJECT_ENDPOINT"], credential=DefaultAzureCredential()).get_openai_client()

response = openai_client.responses.create(
    model="vision",
    input=[
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": question},
                {"type": "input_image", "image_url": f"data:{mime};base64,{image}"},
            ],
        }
    ],
)
print(response.output_text)
