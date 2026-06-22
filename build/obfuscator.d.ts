import type { FeatureDescriptions, ToilDefenderOptions, ToilDefenderResult } from "./types.js";
export declare var features: FeatureDescriptions;
export declare function protect(inputOptions: ToilDefenderOptions): ToilDefenderResult;
declare const api: {
    features: FeatureDescriptions;
    protect: typeof protect;
    do: typeof protect;
};
export { protect as do };
export default api;
