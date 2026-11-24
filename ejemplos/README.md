# Exportar subtítulos a WebVTT

Desde la raíz del proyecto, pasa la carpeta de la grabación entre comillas:

```sh
python3 ejemplos/srt_a_vtt.py "/ruta/a/mi grabación"
```

En Windows también puedes usar `py` en lugar de `python3`. El ejemplo lee el
`subtitulos.srt` que genera Graba y escribe `subtitulos.vtt` en la misma
carpeta. Si ya existe un VTT, lo reemplaza. El SRT se conserva.
