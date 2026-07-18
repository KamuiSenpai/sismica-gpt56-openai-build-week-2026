import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type SeismicEvent } from "@sismica/shared";

import { ApiRequestError, fetchEventExplanation, type EventExplanationResult } from "../lib/api";

type AiEventExplainerProps = {
  event: SeismicEvent;
};

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC"
  }).format(date);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 503) {
    return "OpenAI aun no esta configurado. Activa OPENAI_ENABLED y agrega OPENAI_API_KEY en el backend.";
  }
  return error instanceof Error ? error.message : "No se pudo generar la explicacion.";
}

export function AiEventExplainer({ event }: AiEventExplainerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<EventExplanationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestedEvent, setRequestedEvent] = useState<SeismicEvent | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) return;
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    setResult(null);
    setError(null);
    setRequestedEvent(null);
  }, [event.eventId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const explain = async (targetEvent: SeismicEvent) => {
    setIsOpen(true);
    setRequestedEvent(targetEvent);
    if (result || isLoading) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setError(null);

    try {
      setResult(await fetchEventExplanation(targetEvent, controller.signal));
    } catch (requestError) {
      if (!controller.signal.aborted) setError(errorMessage(requestError));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const retry = () => {
    const targetEvent = requestedEvent ?? event;
    setResult(null);
    setError(null);
    void explain(targetEvent);
  };

  const dialogEvent = requestedEvent ?? event;

  return (
    <>
      <button className="ai-explainer-trigger" type="button" onClick={() => void explain(event)}>
        <span className="ai-explainer-mark">GPT-5.6</span>
        <span>
          <strong>Explicar este evento</strong>
          <small>Build Week / lectura educativa</small>
        </span>
        <i aria-hidden="true">+</i>
      </button>

      {isOpen
        ? createPortal(
            <div className="ai-explainer-backdrop" role="presentation" onMouseDown={() => setIsOpen(false)}>
              <section
                aria-busy={isLoading}
                aria-labelledby="ai-explainer-title"
                aria-modal="true"
                className="ai-explainer-dialog"
                role="dialog"
                onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
              >
                <header className="ai-explainer-header">
                  <div>
                    <span>OPENAI BUILD WEEK / EVENT INTELLIGENCE</span>
                    <strong id="ai-explainer-title">Explicador sismico GPT-5.6</strong>
                  </div>
                  <button aria-label="Cerrar explicador" type="button" onClick={() => setIsOpen(false)}>
                    CERRAR
                  </button>
                </header>

                <div className="ai-explainer-event-strip">
                  <span>{dialogEvent.source}</span>
                  <strong>{dialogEvent.title}</strong>
                  <small>{dialogEvent.eventId}</small>
                </div>

                {isLoading ? (
                  <div className="ai-explainer-loading">
                    <span aria-hidden="true" />
                    <strong>GPT-5.6 esta analizando solo los datos verificados del evento.</strong>
                    <small>Responses API + Structured Outputs</small>
                  </div>
                ) : null}

                {!isLoading && error ? (
                  <div className="ai-explainer-error" role="alert">
                    <span>INTEGRACION NO DISPONIBLE</span>
                    <p>{error}</p>
                    <button type="button" onClick={retry}>
                      REINTENTAR
                    </button>
                  </div>
                ) : null}

                {!isLoading && result ? (
                  <div className="ai-explainer-content">
                    <div className="ai-explainer-lead">
                      <span>LECTURA GENERADA</span>
                      <h2>{result.explanation.headline}</h2>
                      <p>{result.explanation.overview}</p>
                    </div>

                    <div className="ai-explainer-grid">
                      <section>
                        <span>COMO LEER LOS DATOS</span>
                        <p>{result.explanation.technicalReading}</p>
                      </section>
                      <section>
                        <span>ACCIONES PRUDENTES</span>
                        <ul>
                          {result.explanation.recommendedActions.map((action) => (
                            <li key={action}>{action}</li>
                          ))}
                        </ul>
                      </section>
                      <section className="ai-explainer-limitations">
                        <span>LO QUE ESTOS DATOS NO DEMUESTRAN</span>
                        <ul>
                          {result.explanation.dataLimitations.map((limitation) => (
                            <li key={limitation}>{limitation}</li>
                          ))}
                        </ul>
                      </section>
                    </div>

                    <p className="ai-explainer-disclaimer">{result.disclaimer}</p>
                    <footer className="ai-explainer-metadata">
                      <span>
                        PROVEEDOR <strong>{result.provider.toUpperCase()}</strong>
                      </span>
                      <span>
                        MODELO <strong>{result.model}</strong>
                      </span>
                      <span>
                        RESPONSE ID <strong>{result.responseId}</strong>
                      </span>
                      <span>
                        GENERADO UTC <strong>{formatGeneratedAt(result.generatedAtUtc)}</strong>
                      </span>
                      <span>
                        DATOS <strong>BD CANONICA / {result.grounding.sourceCount} FUENTE(S)</strong>
                      </span>
                      <span>
                        CACHE <strong>{result.cached ? "HIT" : "MISS"}</strong>
                      </span>
                      <span>
                        INPUT SHA-256 <strong>{result.grounding.inputSha256.slice(0, 12)}...</strong>
                      </span>
                    </footer>
                  </div>
                ) : null}
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
