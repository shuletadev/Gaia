# Cliente de chat ligero con el SDK de Foundry: habla directamente con el modelo desplegado (sin agente).
#
#   pip install "azure-ai-projects>=2.1.0" azure-identity
#   az login                       (el cliente usa su identidad de Entra; no hay llaves)
#   set PROJECT_ENDPOINT=<valor de projectEndpoint, en las salidas del laboratorio>
#   python chat_client.py

import os

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

project_client = AIProjectClient(
    endpoint=os.environ["PROJECT_ENDPOINT"],
    credential=DefaultAzureCredential(),
)
openai_client = project_client.get_openai_client()

# El nombre del despliegue del modelo (el laboratorio lo llama "agente").
MODEL = os.environ.get("MODEL_DEPLOYMENT", "agente")

instructions = "Eres un asistente amable de una cooperativa de ahorro y crédito de Costa Rica. Responde en español, con frases cortas."

while True:
    question = input("Pregunta (o Enter para salir): ").strip()
    if not question:
        break
    response = openai_client.responses.create(model=MODEL, instructions=instructions, input=question)
    print(response.output_text)
    print()
