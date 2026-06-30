import { type OperationalSourceCode, type SeismicEvent, type SourceCode } from "@sismica/shared";

export type SeismicRecord = {
  event: SeismicEvent;
  rawPayload: unknown;
};

export type SeismicProvider = {
  code: SourceCode;
  fetchEvents: () => Promise<SeismicRecord[]>;
};

export type AuxiliaryProvider<T> = {
  code: OperationalSourceCode;
  fetchItems: () => Promise<Array<{ item: T; rawPayload: unknown }>>;
};
