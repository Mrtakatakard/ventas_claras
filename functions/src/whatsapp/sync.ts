/**
 * @fileoverview Cloud Function to handle WhatsApp synchronization via QR code.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode";

const db = admin.firestore();

// IMPORTANT: whatsapp-web.js is not designed for serverless environments.
// It relies on a persistent browser session (via Puppeteer) which may not work
// reliably in a standard Cloud Function. This function has been configured with
// higher memory and a longer timeout to improve its reliability.
// Puppeteer's dependencies might also need to be configured in the hosting environment.

export const generateWhatsAppQR = onCall({
    memory: '1GiB', 
    timeoutSeconds: 300, 
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado para realizar esta acción.");
    }
    const uid = request.auth.uid;
    logger.info(`Iniciando sincronización de WhatsApp para el usuario: ${uid}`);

    // whatsapp-web.js uses a persistent session. A new client is created for each sync attempt.
    const client = new Client({
        // Using LocalAuth with a specific clientId. In a serverless environment,
        // this session is stored in a temporary filesystem and will be lost.
        authStrategy: new LocalAuth({ clientId: uid }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
        },
    });

    // We use a promise to handle the async events from the library
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            client.destroy();
            reject(new HttpsError('deadline-exceeded', 'El tiempo de espera para escanear el código QR ha expirado.'));
        }, 180000); // 3-minute timeout for user to scan

        client.on('qr', async (qr) => {
            logger.info(`Código QR generado para ${uid}.`);
            try {
                const qrCodeDataURL = await qrcode.toDataURL(qr);
                // Return the QR code to the client-side
                resolve({ qrCode: qrCodeDataURL });
            } catch (err) {
                logger.error(`Error al generar Data URL del QR para ${uid}:`, err);
                clearTimeout(timeout);
                reject(new HttpsError('internal', 'No se pudo generar el código QR.'));
            }
        });

        client.on('authenticated', async () => {
            logger.info(`Usuario ${uid} autenticado con WhatsApp.`);
            clearTimeout(timeout); // Clear the timeout as we are authenticated
            const userPhoneNumber = client.info.wid.user;
            const userProfileRef = db.collection("users").doc(uid);
            try {
                // Save the phone number to Firestore
                await userProfileRef.update({ whatsapp: `+${userPhoneNumber}` });
                logger.info(`Número de WhatsApp +${userPhoneNumber} guardado para el usuario ${uid}.`);
            } catch (error) {
                logger.error(`Error al guardar el número de WhatsApp para ${uid}:`, error);
            } finally {
                // Destroy the client session after a short delay
                setTimeout(() => client.destroy(), 5000);
            }
        });
        
        client.on('ready', () => {
            logger.info(`Cliente de WhatsApp listo para el usuario ${uid}. Si ya estabas autenticado, no se generará un nuevo QR.`);
            clearTimeout(timeout);
            // If already authenticated, there is no QR. Let's provide the number
            const userPhoneNumber = client.info.wid.user;
            db.collection("users").doc(uid).update({ whatsapp: `+${userPhoneNumber}` });
            client.destroy();
            resolve({ qrCode: 'authenticated' });
        });

        client.on('auth_failure', (msg) => {
            logger.error(`Fallo de autenticación de WhatsApp para ${uid}: ${msg}`);
            clearTimeout(timeout);
            reject(new HttpsError('internal', 'Fallo en la autenticación con WhatsApp.'));
        });
        
        client.initialize().catch(err => {
            logger.error('Error al inicializar el cliente de WhatsApp:', err);
            clearTimeout(timeout);
            reject(new HttpsError('internal', 'No se pudo inicializar el servicio de WhatsApp.'));
        });
    });
});