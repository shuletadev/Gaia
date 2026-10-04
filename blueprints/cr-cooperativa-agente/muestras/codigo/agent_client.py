# Cliente ligero para el agente que se creó en el portal de Foundry.
#
#   pip install "azure-ai-projects>=2.1.0" azure-identity
#   az login
#   set PROJECT_ENDPOINT=<valor de projectEndpoint, en las salidas del laboratorio>
#   set AGENT_NAME=<el nombre que le puso al agente>
#   set AGENT_VERSION=1
#   python agent_client.py
#
# Necesita el rol "Azure AI User" sobre el proyecto: no se admiten llaves, solo identidades de Entra.

import os

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

project_client = AIProjectClient(
    endpoint=os.environ["PROJECT_ENDPOINT"],
    credential=DefaultAzureCredential(),
)
openai_client = project_client.get_openai_client()

agent = {
    "name": os.environ["AGENT_NAME"],
    "version": os.environ.get("AGENT_VERSION", "1"),
    "type": "agent_reference",
}

while True:
    question = input("Pregunta (o Enter para salir): ").strip()
    if not question:
        break
    # Se hace referencia al agente para obtener la respuesta, con sus instrucciones y sus documentos.
    response = openai_client.responses.create(
        input=[{"role": "user", "content": question}],
        extra_body={"agent_reference": agent},
    )
    print(response.output_text)
    print()
