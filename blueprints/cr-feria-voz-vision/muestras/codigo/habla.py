# Azure Speech: reconocer lo que dice el micrófono y leer un texto en voz alta, en español de Costa Rica.
#   set SPEECH_KEY=<llave de la cuenta>      set SPEECH_REGION=<región de la cuenta, p. ej. centralus>
#   python habla.py

import os

import azure.cognitiveservices.speech as speechsdk

config = speechsdk.SpeechConfig(subscription=os.environ["SPEECH_KEY"], region=os.environ["SPEECH_REGION"])

# Voz a texto: una frase del micrófono.
config.speech_recognition_language = "es-CR"
recognizer = speechsdk.SpeechRecognizer(speech_config=config)
print("Hable ahora…")
heard = recognizer.recognize_once()
print("Se entendió:", heard.text)

# Texto a voz: la respuesta se lee con una voz de Costa Rica.
config.speech_synthesis_voice_name = "es-CR-MariaNeural"
synthesizer = speechsdk.SpeechSynthesizer(speech_config=config)
synthesizer.speak_text_async("Bienvenidos a la feria del agricultor de Zarcero. Hoy hay verduras frescas en todos los puestos.").get()
