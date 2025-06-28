
/**
 * @fileoverview Main entry point for Firebase Functions.
 * This file should only import and export functions from other modules.
 */

import {initializeApp} from "firebase-admin/app";

// Initialize Firebase Admin SDK
initializeApp();

// Export functions from their respective modules
export * from "./team/invite";
