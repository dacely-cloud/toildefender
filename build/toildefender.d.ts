import type { FeatureDescriptions, ToilDefenderOptions, ToilDefenderResult } from "./types.js";
type ProtectFunction = (inputOptions: ToilDefenderOptions) => ToilDefenderResult;
declare const publicFeatures: FeatureDescriptions;
declare const publicProtect: ProtectFunction;
declare const publicApi: {
    features: FeatureDescriptions;
    protect: ProtectFunction;
    do: ProtectFunction;
};
export type { ControlFlowOptions, FeatureConfig, FeatureDescription, FeatureDescriptions, FeatureName, HashMeshOptions, LogAdapter, LogLevel, NumericVmOptions, ProtectionOptions, ScopeOptions, ToilDefenderOptions, ToilDefenderResult } from "./types.js";
export { publicFeatures as features, publicProtect as protect, publicProtect as do };
export default publicApi;
