
/**
 * @fileoverview Cloud Function to handle team member invitations.
 */

import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = getFirestore();
const auth = getAuth();

export const inviteTeamMember = onCall(async (request) => {
  const {name, email, role} = request.data;

  // Authentication check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado para realizar esta acción.");
  }

  // Authorization check: only admins can invite
  const inviterProfileRef = db.collection("users").doc(request.auth.uid);
  const inviterProfileSnap = await inviterProfileRef.get();
  if (!inviterProfileSnap.exists || inviterProfileSnap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "No tienes permiso para invitar a nuevos miembros.");
  }

  // Input validation
  if (!name || !email || !role) {
    throw new HttpsError("invalid-argument", "Faltan los datos de nombre, email o rol.");
  }

  logger.info(`Iniciando invitación para ${email} por ${request.auth.token.email}`);

  try {
    // 1. Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email: email,
      emailVerified: false,
      displayName: name,
      disabled: false,
    });

    logger.info(`Usuario de Auth creado: ${userRecord.uid}`);

    // 2. Create user profile in Firestore
    const userProfileRef = db.collection("users").doc(userRecord.uid);
    await userProfileRef.set({
      name: name,
      email: email,
      role: role,
      status: "pending", // User is pending until they log in for the first time
      createdAt: new Date(),
    });

    logger.info(`Perfil de Firestore creado para ${userRecord.uid}`);

    logger.info(`Invitación para ${email} procesada exitosamente.`);

    return {success: true, message: `Invitación enviada a ${email}.`};
  } catch (error: any) {
    logger.error("Error al invitar miembro:", error);
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Este correo electrónico ya está en uso.");
    }
    throw new HttpsError("internal", "Ocurrió un error inesperado al procesar la invitación.");
  }
});
