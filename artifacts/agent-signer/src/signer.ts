import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { PaymentRequest } from "./policy.js";

// Ed25519 PKCS#8 v2 DER prefix for a 32-byte raw seed.
// Structure: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING <seed> } }
// Hex: 302e020100300506032b657004220420  (16 bytes) + 32-byte seed = 48 bytes total
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * Produce a canonical JSON string for signing: keys in lexicographic order.
 */
function canonicalJson(obj: PaymentRequest): Buffer {
  const sorted = Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k as keyof PaymentRequest]]),
  );
  return Buffer.from(JSON.stringify(sorted), "utf-8");
}

/** base64url encode (no padding) */
function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

/** base64url decode */
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export class AgentSigner {
  private readonly privateKeyDer: Buffer;
  private readonly publicKeyHex: string;

  /**
   * @param privateKeySeed  32-byte Ed25519 seed. Held in-memory only; never transmitted.
   */
  constructor(privateKeySeed: Uint8Array) {
    if (privateKeySeed.length !== 32) {
      throw new Error("privateKeySeed must be exactly 32 bytes");
    }

    // Wrap seed in PKCS#8 DER envelope so Node crypto can load it.
    this.privateKeyDer = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(privateKeySeed)]);

    // Derive the public key from the private key.
    const privateKeyObj = createPrivateKey({
      key: this.privateKeyDer,
      format: "der",
      type: "pkcs8",
    });
    const publicKeyObj = createPublicKey(privateKeyObj);
    // Export SPKI DER, last 32 bytes are the raw public key.
    const spkiDer = publicKeyObj.export({ type: "spki", format: "der" }) as Buffer;
    this.publicKeyHex = spkiDer.subarray(spkiDer.length - 32).toString("hex");
  }

  /**
   * Sign a payment request.
   * Returns an authorizationPayload (base64url-encoded JSON envelope).
   */
  async sign(
    request: PaymentRequest,
  ): Promise<{ authorizationPayload: string; publicKey: string }> {
    const message = canonicalJson(request);

    const privateKeyObj = createPrivateKey({
      key: this.privateKeyDer,
      format: "der",
      type: "pkcs8",
    });

    const sigBuffer = sign(null, message, privateKeyObj);
    const signature = b64url(sigBuffer);

    const envelope = JSON.stringify({
      publicKey: this.publicKeyHex,
      request,
      signature,
    });

    return {
      authorizationPayload: b64url(Buffer.from(envelope, "utf-8")),
      publicKey: this.publicKeyHex,
    };
  }

  /**
   * Verify an authorizationPayload produced by sign().
   * Returns { valid: true, request } on success or { valid: false } on any failure.
   */
  async verify(
    authorizationPayload: string,
  ): Promise<{ valid: boolean; request?: PaymentRequest }> {
    try {
      const envelopeJson = b64urlDecode(authorizationPayload).toString("utf-8");
      const envelope = JSON.parse(envelopeJson) as {
        request: PaymentRequest;
        signature: string;
        publicKey: string;
      };

      const { request, signature, publicKey: pubKeyHex } = envelope;

      // Reconstruct canonical message from the embedded request.
      const message = canonicalJson(request);
      const sigBuffer = b64urlDecode(signature);

      // Reconstruct SPKI DER from raw hex public key (32 bytes).
      // SPKI DER prefix for Ed25519: 302a300506032b6571032100  (12 bytes) + 32-byte public key
      const spkiPrefix = Buffer.from("302a300506032b6571032100", "hex");
      const rawPubKey = Buffer.from(pubKeyHex, "hex");
      const spkiDer = Buffer.concat([spkiPrefix, rawPubKey]);

      const publicKeyObj = createPublicKey({
        key: spkiDer,
        format: "der",
        type: "spki",
      });

      const valid = verify(null, message, publicKeyObj, sigBuffer);
      if (!valid) return { valid: false };

      return { valid: true, request };
    } catch {
      return { valid: false };
    }
  }
}

export function createAgentSigner(privateKeySeed: Uint8Array): AgentSigner {
  return new AgentSigner(privateKeySeed);
}
