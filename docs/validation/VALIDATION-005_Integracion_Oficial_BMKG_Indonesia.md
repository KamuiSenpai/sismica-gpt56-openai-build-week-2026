# VALIDATION-005 Integracion Oficial BMKG Indonesia

## Resultado

Conforme. BMKG fue integrada y validada el 30 de junio de 2026.

## Evidencia funcional

| Verificacion              | Evidencia                                                          | Resultado |
| ------------------------- | ------------------------------------------------------------------ | --------- |
| Contratos externos        | feeds M5+ y sentidos respondieron con JSON valido                  | Conforme  |
| Primera ingesta observada | 1 insercion y 2 asociaciones                                       | Conforme  |
| Referencias BMKG          | 3 referencias dentro de la ventana de 72 horas                     | Conforme  |
| Prioridad regional        | las 3 referencias muestran BMKG como fuente preferida              | Conforme  |
| Idempotencia              | corrida repetida: 0 inserciones, 0 actualizaciones, 0 asociaciones | Conforme  |
| Unicidad                  | cero duplicados por `(source, source_event_id)`                    | Conforme  |
| Estado API                | BMKG `success`; catalogo de fuentes expuesto                       | Conforme  |
| Continuidad               | `/api/health` y frontend respondieron HTTP 200                     | Conforme  |

Los conteos son una instantanea de validacion y variaran con los eventos
publicados por BMKG.

## Muestras persistidas

Se validaron eventos BMKG con intensidad textual, entre ellos reportes para
Halmahera, Tanggamus y Sumba. Dos referencias coincidieron con eventos EMSC y
se asociaron sin crear marcadores duplicados; una referencia genero un nuevo
evento canonico.

## Evidencia automatizada

```text
Pruebas unitarias: 13
Correctas: 13
Fallidas: 0
Typecheck: correcto
Build: correcto
```

## Seguridad y responsabilidad

1. El campo de tsunami se interpreta como dato BMKG y no como alerta propia.
2. La frase `Tidak berpotensi tsunami` no genera un positivo falso.
3. La consulta se mantiene muy por debajo del limite oficial de 60 solicitudes
   por minuto.
4. Se conserva el payload para auditoria y trazabilidad.

## Riesgo residual

BMKG no publica un identificador explicito en los feeds utilizados. El
identificador determinista es estable mientras no cambien hora o coordenadas.
Una revision de esos campos puede generar otra referencia BMKG; este caso debe
resolverse en una futura politica de reconciliacion de revisiones de la misma
fuente.

## Conclusion

BMKG queda habilitada como fuente nacional oficial preferida para Indonesia,
con aislamiento de fallas, fusion de feeds, deduplicacion multifuente y estado
operativo visible mediante la API.
