/**
 * @fileoverview Cloud Function to handle deleting an invoice and adjusting stock.
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

const db = admin.firestore();

export const deleteInvoiceAndAdjustStock = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado para realizar esta acción.");
  }

  const {invoiceId} = request.data;
  if (!invoiceId) {
    throw new HttpsError("invalid-argument", "Se requiere el ID de la factura.");
  }

  const uid = request.auth.uid;
  const invoiceRef = db.collection("invoices").doc(invoiceId);

  try {
    await db.runTransaction(async (transaction) => {
      // 1. Read the invoice
      const invoiceDoc = await transaction.get(invoiceRef);
      if (!invoiceDoc.exists) {
        throw new HttpsError("not-found", "La factura no existe.");
      }

      const invoice = invoiceDoc.data();
      if (!invoice) {
        throw new HttpsError("data-loss", "No se encontraron datos en la factura.");
      }

      // 2. Authorization check
      if (invoice.userId !== uid) {
        throw new HttpsError("permission-denied", "No tienes permiso para eliminar esta factura.");
      }

      // 3. Validation: Can't delete if it has payments
      if (invoice.payments && invoice.payments.length > 0) {
        throw new HttpsError("failed-precondition", "No se pueden eliminar facturas con pagos aplicados.");
      }

      // 4. Adjust product stock for each item in the invoice
      if (invoice.items && invoice.items.length > 0) {
        for (const item of invoice.items) {
          const productRef = db.collection("products").doc(item.productId);
          const productDoc = await transaction.get(productRef);

          if (productDoc.exists) {
            const currentStock = productDoc.data()?.stock || 0;
            const newStock = currentStock + item.quantity;
            transaction.update(productRef, {stock: newStock});
            logger.info(`Stock for product ${item.productId} adjusted from ${currentStock} to ${newStock}.`);
          } else {
            logger.warn(`Product ${item.productId} not found for stock adjustment during invoice deletion.`);
          }
        }
      }

      // 5. Delete the invoice
      transaction.delete(invoiceRef);
    });

    logger.info(`Invoice ${invoiceId} deleted successfully by user ${uid}.`);
    return {success: true, message: "Factura eliminada y stock ajustado correctamente."};
  } catch (error: any) {
    logger.error(`Error deleting invoice ${invoiceId}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Ocurrió un error inesperado al eliminar la factura.");
  }
});
