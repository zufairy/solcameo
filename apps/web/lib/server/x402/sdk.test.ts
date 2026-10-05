// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { address, createKeyPairSignerFromBytes, getTransactionDecoder, getBase64Encoder } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { encodePaymentSignatureHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import { SOLANA_DEVNET, DEVNET_USDC } from "./config";
afterEach(() => vi.unstubAllGlobals());
describe("official Solana x402 SDK compatibility", () => {
  it("builds and signs a real exact-SVM payment transaction with a sponsored fee payer", async () => {
    const buyer = Keypair.generate(); const feePayer = Keypair.generate(); const seller = Keypair.generate();
    const mintBytes = Buffer.alloc(MintLayout.span);
    MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:BigInt(100000000),decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintBytes);
    vi.stubGlobal("fetch",vi.fn(async (_url, init) => {
      const input = JSON.parse(String(init?.body));
      const result = input.method === "getAccountInfo" ? {context:{slot:1},value:{data:[mintBytes.toString("base64"),"base64"],executable:false,lamports:1,owner:TOKEN_PROGRAM_ID.toBase58(),rentEpoch:0}} : {context:{slot:1},value:{blockhash:PublicKey.default.toBase58(),lastValidBlockHeight:100}};
      return Response.json({jsonrpc:"2.0",id:input.id,result});
    }));
    const signer = await createKeyPairSignerFromBytes(buyer.secretKey);
    const client = new x402Client().register(SOLANA_DEVNET,new ExactSvmScheme(signer,{rpcUrl:"https://rpc.test"}));
    const payload = await client.createPaymentPayload({x402Version:2,resource:{url:"https://vello.test/report"},accepts:[{scheme:"exact",network:SOLANA_DEVNET,asset:DEVNET_USDC,amount:"10000",payTo:seller.publicKey.toBase58(),maxTimeoutSeconds:60,extra:{feePayer:feePayer.publicKey.toBase58()}}]});
    const decoded = decodePaymentSignatureHeader(encodePaymentSignatureHeader(payload));
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(String(decoded.payload.transaction)));
    expect(tx.signatures[address(buyer.publicKey.toBase58())]).not.toBeNull();
    expect(tx.signatures[address(feePayer.publicKey.toBase58())]).toBeNull();
    expect(Object.entries(tx.signatures).filter(([,sig])=>sig!==null)).toHaveLength(1);
    expect(decoded.accepted.amount).toBe("10000");
  });
});
