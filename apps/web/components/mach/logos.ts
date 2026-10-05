// Real integration logos (monochrome white SVGs from Simple Icons), plus
// wordmarks for the few Solana-ecosystem brands without a clean mark available.
// Imported from /assets so they're bundled and fingerprinted by Next.

import solana from "@/assets/logos/solana.svg";
import openai from "@/assets/logos/openai.svg";
import anthropic from "@/assets/logos/anthropic.svg";
import stripe from "@/assets/logos/stripe.svg";
import shopify from "@/assets/logos/shopify.svg";
import whatsapp from "@/assets/logos/whatsapp.svg";
import instagram from "@/assets/logos/instagram.svg";
import tiktok from "@/assets/logos/tiktok.svg";
import youtube from "@/assets/logos/youtube.svg";
import x from "@/assets/logos/x.svg";
import discord from "@/assets/logos/discord.svg";
import telegram from "@/assets/logos/telegram.svg";
import meta from "@/assets/logos/meta.svg";
import google from "@/assets/logos/google.svg";
import gemini from "@/assets/logos/googlegemini.svg";
import vercel from "@/assets/logos/vercel.svg";
import nextjs from "@/assets/logos/nextdotjs.svg";
import supabase from "@/assets/logos/supabase.svg";
import cloudflare from "@/assets/logos/cloudflare.svg";
import coinbase from "@/assets/logos/coinbase.svg";
import ethereum from "@/assets/logos/ethereum.svg";
import polygon from "@/assets/logos/polygon.svg";
import chainlink from "@/assets/logos/chainlink.svg";
import shopee from "@/assets/logos/shopee.svg";
import razorpay from "@/assets/logos/razorpay.svg";
import wise from "@/assets/logos/wise.svg";

// Static SVG imports may resolve to a string URL or a { src } object depending
// on the loader — normalise to a plain URL string.
const url = (v: unknown): string =>
  typeof v === "string" ? v : (v as { src: string }).src;

export type IntegrationItem = { label: string; logo?: string };

// Row 1 — AI, payments, commerce, social.
export const integrationLogosRow1: IntegrationItem[] = [
  { label: "OpenAI", logo: url(openai) },
  { label: "Anthropic", logo: url(anthropic) },
  { label: "Gemini", logo: url(gemini) },
  { label: "Stripe", logo: url(stripe) },
  { label: "Shopify", logo: url(shopify) },
  { label: "WhatsApp", logo: url(whatsapp) },
  { label: "Instagram", logo: url(instagram) },
  { label: "TikTok", logo: url(tiktok) },
  { label: "YouTube", logo: url(youtube) },
  { label: "X", logo: url(x) },
  { label: "Discord", logo: url(discord) },
  { label: "Telegram", logo: url(telegram) },
  { label: "Meta", logo: url(meta) },
  { label: "Google", logo: url(google) },
];

// Row 2 — web3 + infrastructure (wordmarks for brands without a clean mark).
export const integrationLogosRow2: IntegrationItem[] = [
  { label: "Solana", logo: url(solana) },
  { label: "Phantom" },
  { label: "Jupiter" },
  { label: "Helius" },
  { label: "Magic Eden" },
  { label: "Ethereum", logo: url(ethereum) },
  { label: "Coinbase", logo: url(coinbase) },
  { label: "Polygon", logo: url(polygon) },
  { label: "Chainlink", logo: url(chainlink) },
  { label: "Vercel", logo: url(vercel) },
  { label: "Next.js", logo: url(nextjs) },
  { label: "Supabase", logo: url(supabase) },
  { label: "Cloudflare", logo: url(cloudflare) },
  { label: "Shopee", logo: url(shopee) },
  { label: "Razorpay", logo: url(razorpay) },
  { label: "Wise", logo: url(wise) },
];
