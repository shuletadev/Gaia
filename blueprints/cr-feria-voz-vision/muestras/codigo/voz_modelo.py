# Preguntas habladas: se envía un audio (WAV) a un modelo multimodal y responde con texto y con voz.
#   python voz_modelo.py pregunta.wav respuesta.wav

import base64
import os
import sys

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

question_wav, answer_wav = sys.argv[1], sys.argv[2]
audio = base64.b64encode(open(question_wav, "rb").read()).decode()

openai_client = AIProjectClient(endpoint=os.environ["PROJECT_ENDPOINT"], credential=DefaultAzureCredential()).get_openai_client()

completion = openai_client.chat.completions.create(
    model="voz",
    modalities=["text", "audio"],
    audio={"voice": "alloy", "format": "wav"},
    messages=[
        {"role": "system", "content": "Eres el asistente de la feria del agricultor. Responde en español, con frases cortas."},
        {"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": audio, "format": "wav"}}]},
    ],
)
message = completion.choices[0].message
print(message.audio.transcript if message.audio else message.content)
if message.audio:
    open(answer_wav, "wb").write(base64.b64decode(message.audio.data))
    print(f"Respuesta hablada guardada en {answer_wav}")
