import api, { features, protect } from "./obfuscator.js";
import type { FeatureDescriptions, ToilDefenderOptions, ToilDefenderResult } from "./types.js";

type ProtectFunction = (inputOptions: ToilDefenderOptions) => ToilDefenderResult;

const publicFeatures: FeatureDescriptions = features;
const publicProtect: ProtectFunction = protect;
const publicApi: {
    features: FeatureDescriptions;
    protect: ProtectFunction;
    do: ProtectFunction;
} = api;

export type {
    ControlFlowOptions,
    FeatureConfig,
    FeatureDescription,
    FeatureDescriptions,
    FeatureName,
    HashMeshOptions,
    LogAdapter,
    LogLevel,
    NumericVmOptions,
    ProtectionOptions,
    ScopeOptions,
    ToilDefenderOptions,
    ToilDefenderResult
} from "./types.js";

export { publicFeatures as features, publicProtect as protect, publicProtect as do };
export default publicApi;
