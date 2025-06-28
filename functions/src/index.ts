
/**
 * @fileoverview Main entry point for Firebase Functions.
 * This file should only import and export functions from other modules.
 */


import * as admin from "firebase-admin";


admin.initializeApp();

// Export functions from their respective modules
export * from "./team/invite";
export * from "./invoicing/receivables";

