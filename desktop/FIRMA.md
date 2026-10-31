# Firmar la app de Mac para que abra sin advertencias

Apple exige que toda app distribuida fuera de la App Store esté firmada con un certificado "Developer ID" y notarizada. Sin eso, macOS muestra "Apple could not verify…". No hay forma técnica de evitarlo desde el código: es una política de Apple.

## Pasos (una sola vez, unos 30 minutos)
1. Inscribirse en el Apple Developer Program: https://developer.apple.com/programs/ (99 USD/año).
2. En https://developer.apple.com/account/resources/certificates crear un certificado **Developer ID Application** y descargarlo. Instalarlo en el Llavero del Mac.
3. En Acceso a Llaveros, exportar ese certificado como archivo `.p12` con una contraseña.
4. Convertirlo a texto: `base64 -i certificado.p12 | pbcopy`.
5. En https://appleid.apple.com → Iniciar sesión y seguridad → Contraseñas de app, crear una contraseña de app.
6. En GitHub → repositorio → Settings → Secrets and variables → Actions, crear estos secretos:
   - `MAC_CERT_P12_BASE64`: el texto copiado en el paso 4
   - `MAC_CERT_PASSWORD`: la contraseña del .p12
   - `APPLE_ID`: el correo de la cuenta Apple
   - `APPLE_APP_SPECIFIC_PASSWORD`: la contraseña de app del paso 5
   - `APPLE_TEAM_ID`: el Team ID que aparece en https://developer.apple.com/account (10 caracteres)
7. Volver a ejecutar el flujo "Desktop app" en Actions. El DMG resultante se abre con doble clic en cualquier Mac.

Para Windows, el equivalente es un certificado de firma de código (EV o OV). Sin él, SmartScreen muestra "Windows protegió su PC" y el usuario pulsa "Más información → Ejecutar de todas formas".
