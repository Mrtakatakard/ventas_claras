/**
 * @fileoverview Cloud Function to handle fetching accounts receivable.
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

const db = admin.firestore();

export const getAccountsReceivable = onCall(async (request) => {
  // 1. Authentication check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado para realizar esta acción.");
  }

  const uid = request.auth.uid;
  logger.info(`Fetching accounts receivable for user: ${uid}`);

  try {
    // 2. Query for invoices with a balance due
    const invoicesRef = db.collection("invoices");
    const q = invoicesRef
      .where("userId", "==", uid)
      .where("balanceDue", ">", 0);

    const querySnapshot = await q.get();

    // 3. Map the results
    const receivableInvoices = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    logger.info(`Found ${receivableInvoices.length} receivable invoices for user: ${uid}`);

    return {invoices: receivableInvoices};
  } catch (error: any) {
    logger.error("Error fetching accounts receivable:", error);
    // This could happen if the composite index is not created yet.
    // The error message in the Firebase console will contain a link to create it.
    throw new HttpsError("failed-precondition", "No se pudieron cargar los datos porque falta un índice en la base de datos. Revisa los logs de la función en la consola de Firebase para encontrar un enlace para crearlo automáticamente.");
  }
});
