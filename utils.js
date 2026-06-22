import assert from "assert";
import _ from "lodash";
import escodegen from "escodegen";
import esprima from "esprima";
import traverser from "./traverser.js";

export function splice(arr, pos, del, elems) {
    Array.prototype.splice.apply(arr, [ pos, del ].concat(elems));
}

export function unshift(arr, arr2) {
    if (Array.isArray(arr2)) {
        Array.prototype.unshift(arr, arr2);
    } else {
        arr.push(arr2);
    }
}

export function push(arr, arr2) {
    if (Array.isArray(arr2)) {
        Array.prototype.push.apply(arr, arr2);
    } else {
        arr.push(arr2);
    }
}

export function array(obj) {
    return Array.isArray(obj) ? obj : [ obj ];
}

export function cloneISwearIKnowWhatImDoing(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a random number.
 * @param {number} Inclusive minimum
 * @param {number} Inclusive maximum
 * @returns {number}
 */
export function random(minimum, maximum) {
    return Math.floor(Math.random() * (maximum - minimum)) + minimum;
}

export function randomAlpha(length) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    for (var i=0; i < length; i++) { 
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

export function isResolvedReference(reference) {
    return reference.resolved != null
        && reference.resolved.defs != null
        && reference.resolved.defs.length > 0;
}

export function UniqueRandom(max) {
    assert(typeof max == "number");
    if (max > 32768) {
        console.warn(`Allocating large (${max}) UniqueRandom instance`);
    }
    var arr = _.shuffle(_.range(max));
    var idx = 0;
    
    this.get = function() {
        if (idx < max) {
            return arr[idx++];
        } else {
            throw new Error("No numbers left");
        }
    };
}

export function UniqueRandomAlpha(len) {
    assert(typeof len == "number");
    var offset = Math.pow(32, len - 1);
    var rng = new UniqueRandom(offset * 31);
    
    this.get = function() {
        return (offset + rng.get()).toString(32);  
    };
}

export function HashMap() {
    var store = {};
    
    this.get = function (key) {
        return store["HashMap" + key];
    };
    
    this.set = function (key, value) {
        return store["HashMap" + key] = value;
    };
    
    this.exists = function (key) {
        return store["HashMap" + key] !== undefined;
    };
    
    this.remove = function (key) {
        delete store["HashMap" + key];
    };
}

export function hash(obj) {
    if (obj == null) {
        return "x";
    }
    
    if (typeof obj == "string") {
        return "s" + obj;
    }
    
    if (typeof obj == "number") {
        return "n" + obj.toString();
    }
    
    if (!obj.$$hash) {
        Object.defineProperty(obj, "$$hash", {
            configurable: false,
            enumerable: false,
            value: "o" + randomAlpha(8)
        });
    }
    
    return obj.$$hash;
}

export default {
    splice,
    unshift,
    push,
    array,
    cloneISwearIKnowWhatImDoing,
    random,
    randomAlpha,
    isResolvedReference,
    UniqueRandom,
    UniqueRandomAlpha,
    HashMap,
    hash
};
