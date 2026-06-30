# VALIDATION-004 Ampliacion de Fuentes Oficiales

## Resultado

Conforme. La ampliacion definida por `SDD-004` fue implementada y validada el
30 de junio de 2026.

## Evidencia funcional

| Verificacion | Evidencia | Resultado |
| --- | --- | --- |
| GEOFON | 62 referencias; primera corrida con 58 asociaciones y 4 inserciones | Conforme |
| GeoNet | 26 referencias; primera corrida con 6 asociaciones y 20 inserciones | Conforme |
| Estado por fuente | nueve fuentes con estado `success` | Conforme |
| Unicidad | cero duplicados por `(source, source_event_id)` | Conforme |
| Canonicos multifuente | 36 preferidos GEOFON y 6 preferidos GeoNet con mas de una fuente | Conforme |
| API | `/api/sources/status` respondio correctamente | Conforme |
| Frontend | `http://localhost:5173/` respondio HTTP 200 | Conforme |

Los conteos corresponden a la instantanea de validacion y pueden aumentar con
nuevas corridas. No constituyen una cifra contractual del catalogo.

## Evidencia automatizada

```text
Pruebas: 10
Correctas: 10
Fallidas: 0
Typecheck: correcto
Build: correcto
```

## Evaluacion de deduplicacion

GEOFON produjo 62 referencias, pero solo cuatro eventos canonicos nuevos en su
primera corrida. GeoNet produjo 26 referencias, con seis asociaciones a
eventos existentes. Esto confirma que los adaptadores participan en el modelo
canonico y no agregan una copia visible por cada proveedor.

## Fuentes no activadas

1. DHN/CNAT Peru: sin API publica documentada localizada para sus boletines.
2. SGC Colombia: el ArcGIS oficial evaluado tiene como fecha maxima el 30 de
   diciembre de 2020 y no representa el estado actual.
3. CSN Chile: el servidor FDSN publico verificado no anuncia servicio Event.
4. ISC: se reserva para reconciliacion historica separada debido al retraso del
   boletin revisado y a la consolidacion de contribuciones recientes.

No se implemento scraping para ninguna de estas fuentes.

## Riesgos residuales

1. Las APIs externas pueden aplicar limites, cambiar formato o interrumpirse.
2. GeoNet entrega hasta 100 eventos en el endpoint utilizado; el worker aplica
   ventana temporal y magnitud minima localmente.
3. GEOFON e ISC pueden compartir contribuciones; ISC no debe incorporarse al
   flujo operativo sin una politica adicional de reconciliacion.

## Conclusion

GEOFON y GeoNet quedan habilitadas como fuentes oficiales operativas. La
plataforma conserva aislamiento de fallas, trazabilidad y ausencia de
duplicidad por proveedor. Las demas fuentes permanecen documentadas y
condicionadas a un contrato de acceso tecnicamente adecuado.
