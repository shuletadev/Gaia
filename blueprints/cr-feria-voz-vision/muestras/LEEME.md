# Feria del Agricultor de Zarcero (ficticia): archivos de la clase

Cuatro programas cortos en Python, uno por capacidad. Todos leen `PROJECT_ENDPOINT` (salida `projectEndpoint` del laboratorio) y usan su identidad de Entra (`az login`) y el rol **Azure AI User** sobre el proyecto, salvo `habla.py`, que usa la llave y la región de la cuenta (en el portal de Azure: Llaves y punto de conexión).

| Archivo | Qué muestra | Despliegue que usa |
|---|---|---|
| `vision.py` | Enviar una foto junto con una pregunta | `vision` |
| `voz_modelo.py` | Preguntar con la voz a un modelo multimodal | `voz` |
| `afiche.py` | Generar la imagen de un afiche | `afiche` |
| `habla.py` | Reconocer y sintetizar voz con Azure Speech (es-CR) | ninguno (Speech viene con el recurso) |

Instalación: `pip install "azure-ai-projects>=2.1.0" azure-identity azure-cognitiveservices-speech`

Estos programas no se ejecutaron contra una suscripción real al escribir el laboratorio: pruébelos antes de la clase.
Las fotos y los audios de prueba los pone usted (una foto de un puesto de la feria y una grabación corta con el celular). Todo es de ejemplo.
