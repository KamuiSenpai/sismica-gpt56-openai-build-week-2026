export type SourceCode = "USGS";
export type SeismicEvent = {
    eventId: string;
    source: SourceCode;
    sourceEventId: string;
    title: string;
    magnitude: number | null;
    magnitudeType: string | null;
    latitude: number;
    longitude: number;
    depthKm: number | null;
    eventTimeUtc: string;
    updatedAtUtc: string | null;
    status: string | null;
    sourceUrl: string | null;
    ingestedAt: string;
};
export type SourceStatus = {
    source: SourceCode;
    lastRunStartedAt: string | null;
    lastRunFinishedAt: string | null;
    status: "success" | "error" | "running" | "unknown";
    insertedCount: number;
    updatedCount: number;
    errorMessage: string | null;
};
export type EventsQuery = {
    minMagnitude: number;
    hours: number;
    limit: number;
};
export type StreamEvent = {
    type: "event.created";
    payload: SeismicEvent;
};
export type UsgsFeature = {
    id: string;
    properties: {
        mag: number | null;
        magType?: string;
        place?: string;
        time?: number;
        updated?: number;
        status?: string;
        title?: string;
        url?: string;
    };
    geometry: {
        coordinates: [number, number, number?];
    };
};
export type UsgsGeoJson = {
    features: UsgsFeature[];
};
export declare const DEFAULT_MIN_MAGNITUDE = 2.5;
export declare const DEFAULT_HOURS = 24;
export declare const DEFAULT_LIMIT = 100;
export declare function buildEventId(source: SourceCode, sourceEventId: string): string;
export declare function clampNumber(value: number, min: number, max: number): number;
export declare function isFiniteNumber(value: unknown): value is number;
