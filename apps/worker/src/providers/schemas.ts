import { z, type ZodTypeAny } from "zod";

// Valida la ESTRUCTURA de la respuesta externa antes de normalizar/persistir.
// Lanza un error etiquetado por fuente si el payload no es lo esperado
// (p. ej. una pagina HTML de error, un objeto de error, o un contenedor distinto).
// El detalle por campo de cada item lo siguen resolviendo los normalizadores
// (que descartan registros incompletos de forma tolerante).
export function assertShape(schema: ZodTypeAny, data: unknown, source: string): void {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "estructura invalida";
    throw new Error(`${source}: respuesta externa con estructura invalida (${where})`);
  }
}

const featureCollectionSchema = z
  .object({ features: z.array(z.object({}).passthrough()).optional() })
  .passthrough();

// USGS GeoJSON: ademas exige id y coordenadas numericas (lon, lat[, prof]).
export const usgsGeoJsonSchema = z
  .object({
    features: z.array(
      z
        .object({
          id: z.string(),
          geometry: z.object({ coordinates: z.array(z.number()).min(2) }).passthrough(),
          properties: z.object({ mag: z.number().nullable().optional() }).passthrough().nullish()
        })
        .passthrough()
    )
  })
  .passthrough();

export const emscResponseSchema = featureCollectionSchema;
export const funvisisResponseSchema = featureCollectionSchema;
export const gdacsResponseSchema = featureCollectionSchema;
export const geoNetResponseSchema = featureCollectionSchema;
export const sgcResponseSchema = featureCollectionSchema;

export const bmkgResponseSchema = z
  .object({
    Infogempa: z.object({
      gempa: z.array(
        z
          .object({
            DateTime: z.string(),
            Coordinates: z.string()
          })
          .passthrough()
      )
    })
  })
  .passthrough();

export const cwaResponseSchema = z
  .object({
    success: z.string(),
    records: z
      .object({
        Earthquake: z.array(
          z
            .object({
              Web: z.string().optional(),
              IssueTime: z.string(),
              EarthquakeInfo: z
                .object({
                  OriginTime: z.string(),
                  Epicenter: z
                    .object({
                      EpicenterLatitude: z.number(),
                      EpicenterLongitude: z.number()
                    })
                    .passthrough(),
                  EarthquakeMagnitude: z
                    .object({
                      MagnitudeValue: z.number()
                    })
                    .passthrough()
                })
                .passthrough()
            })
            .passthrough()
        )
      })
      .passthrough()
  })
  .passthrough();

// JMA (bosai): arreglo de reportes en la raiz; cada item con eid (id de evento).
export const jmaListSchema = z.array(
  z
    .object({
      eid: z.string()
    })
    .passthrough()
);

// IGP devuelve un arreglo de registros en la raiz.
export const igpResponseSchema = z.array(z.object({}).passthrough());
