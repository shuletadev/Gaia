# Salida visual: generar la imagen de un afiche con un modelo de generación de imágenes.
#   python afiche.py "Afiche de la Feria del Agricultor de Zarcero, verduras frescas, estilo ilustración" afiche.png

import base64
import os
import sys

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

prompt, out = sys.argv[1], sys.argv[2]

openai_client = AIProjectClient(endpoint=os.environ["PROJECT_ENDPOINT"], credential=DefaultAzureCredential()).get_openai_client()

result = openai_client.images.generate(model="afiche", prompt=prompt, size="1024x1024", n=1)
open(out, "wb").write(base64.b64decode(result.data[0].b64_json))
print(f"Imagen guardada en {out}")
