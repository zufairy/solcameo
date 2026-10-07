/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminBuilder from "../adminBuilder.js";
import type * as adminCampaigns from "../adminCampaigns.js";
import type * as adminControlPanel from "../adminControlPanel.js";
import type * as adminEconomy from "../adminEconomy.js";
import type * as adminPricing from "../adminPricing.js";
import type * as adsLibraryCache from "../adsLibraryCache.js";
import type * as agentAccount from "../agentAccount.js";
import type * as agentAddons from "../agentAddons.js";
import type * as agentAutonomy from "../agentAutonomy.js";
import type * as agentKnowledge from "../agentKnowledge.js";
import type * as agentSkillFiles from "../agentSkillFiles.js";
import type * as agentStyleReferences from "../agentStyleReferences.js";
import type * as agentTasks from "../agentTasks.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as autoClip from "../autoClip.js";
import type * as builder from "../builder.js";
import type * as builderSessions from "../builderSessions.js";
import type * as campaignMemberships from "../campaignMemberships.js";
import type * as campaignTranscribe from "../campaignTranscribe.js";
import type * as campaigns from "../campaigns.js";
import type * as carouselImages from "../carouselImages.js";
import type * as carouselProjects from "../carouselProjects.js";
import type * as clipGraphs from "../clipGraphs.js";
import type * as clipJobs from "../clipJobs.js";
import type * as clipStorage from "../clipStorage.js";
import type * as communityChat from "../communityChat.js";
import type * as contentControl from "../contentControl.js";
import type * as contentIdeas from "../contentIdeas.js";
import type * as contentRewardMeasurements from "../contentRewardMeasurements.js";
import type * as controlPanel from "../controlPanel.js";
import type * as crons from "../crons.js";
import type * as describeVideo from "../describeVideo.js";
import type * as devTeamSchedule from "../devTeamSchedule.js";
import type * as devWipe from "../devWipe.js";
import type * as distributions from "../distributions.js";
import type * as documentaryProjects from "../documentaryProjects.js";
import type * as downloadCache from "../downloadCache.js";
import type * as downloadJobs from "../downloadJobs.js";
import type * as earnings from "../earnings.js";
import type * as economyReconcile from "../economyReconcile.js";
import type * as email from "../email.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as influencers from "../influencers.js";
import type * as investments from "../investments.js";
import type * as jobApplications from "../jobApplications.js";
import type * as launchRuns from "../launchRuns.js";
import type * as leads from "../leads.js";
import type * as lib_accountLookup from "../lib/accountLookup.js";
import type * as lib_appFetch from "../lib/appFetch.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_calloutTrade from "../lib/calloutTrade.js";
import type * as lib_characterAgent from "../lib/characterAgent.js";
import type * as lib_controlPanelValidators from "../lib/controlPanelValidators.js";
import type * as lib_launchOptions from "../lib/launchOptions.js";
import type * as lib_marketSummary from "../lib/marketSummary.js";
import type * as lib_passwordAuth from "../lib/passwordAuth.js";
import type * as lib_payments from "../lib/payments.js";
import type * as lib_solanaVerify from "../lib/solanaVerify.js";
import type * as lib_solstarAuth from "../lib/solstarAuth.js";
import type * as lib_supabaseAuth from "../lib/supabaseAuth.js";
import type * as lib_terminalStats from "../lib/terminalStats.js";
import type * as liveChat from "../liveChat.js";
import type * as migrations_backfillHandleLower from "../migrations/backfillHandleLower.js";
import type * as migrations_mergeClipforgeIntoFoundersClub from "../migrations/mergeClipforgeIntoFoundersClub.js";
import type * as mintFee from "../mintFee.js";
import type * as nftAgents from "../nftAgents.js";
import type * as nodeApplications from "../nodeApplications.js";
import type * as opsInterns from "../opsInterns.js";
import type * as oracle from "../oracle.js";
import type * as platformLaunch from "../platformLaunch.js";
import type * as platformStats from "../platformStats.js";
import type * as platformToken from "../platformToken.js";
import type * as referrals from "../referrals.js";
import type * as sampleRuns from "../sampleRuns.js";
import type * as scheduledContent from "../scheduledContent.js";
import type * as scheduledRecreations from "../scheduledRecreations.js";
import type * as seriesEpisodes from "../seriesEpisodes.js";
import type * as shareRedemptions from "../shareRedemptions.js";
import type * as shares from "../shares.js";
import type * as solstarBudget from "../solstarBudget.js";
import type * as solstarCatalog from "../solstarCatalog.js";
import type * as solstarChain from "../solstarChain.js";
import type * as solstarCreate from "../solstarCreate.js";
import type * as solstarDiscovery from "../solstarDiscovery.js";
import type * as solstarFeed from "../solstarFeed.js";
import type * as solstarFlywheel from "../solstarFlywheel.js";
import type * as solstarLiveCam from "../solstarLiveCam.js";
import type * as solstarMarket from "../solstarMarket.js";
import type * as solstarTrade from "../solstarTrade.js";
import type * as storageMigration from "../storageMigration.js";
import type * as studioGen from "../studioGen.js";
import type * as submissions from "../submissions.js";
import type * as tasteEvents from "../tasteEvents.js";
import type * as tournament from "../tournament.js";
import type * as transcriptCache from "../transcriptCache.js";
import type * as ugcSampleRuns from "../ugcSampleRuns.js";
import type * as usage from "../usage.js";
import type * as userCredits from "../userCredits.js";
import type * as userGenerations from "../userGenerations.js";
import type * as users from "../users.js";
import type * as videoJobArgs from "../videoJobArgs.js";
import type * as videoJobs from "../videoJobs.js";
import type * as videoJobsGenerate from "../videoJobsGenerate.js";
import type * as videoProgress from "../videoProgress.js";
import type * as videoRecreateProjects from "../videoRecreateProjects.js";
import type * as videoRenderJobs from "../videoRenderJobs.js";
import type * as withdrawals from "../withdrawals.js";
import type * as x402 from "../x402.js";
import type * as xAccounts from "../xAccounts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminBuilder: typeof adminBuilder;
  adminCampaigns: typeof adminCampaigns;
  adminControlPanel: typeof adminControlPanel;
  adminEconomy: typeof adminEconomy;
  adminPricing: typeof adminPricing;
  adsLibraryCache: typeof adsLibraryCache;
  agentAccount: typeof agentAccount;
  agentAddons: typeof agentAddons;
  agentAutonomy: typeof agentAutonomy;
  agentKnowledge: typeof agentKnowledge;
  agentSkillFiles: typeof agentSkillFiles;
  agentStyleReferences: typeof agentStyleReferences;
  agentTasks: typeof agentTasks;
  analytics: typeof analytics;
  auth: typeof auth;
  autoClip: typeof autoClip;
  builder: typeof builder;
  builderSessions: typeof builderSessions;
  campaignMemberships: typeof campaignMemberships;
  campaignTranscribe: typeof campaignTranscribe;
  campaigns: typeof campaigns;
  carouselImages: typeof carouselImages;
  carouselProjects: typeof carouselProjects;
  clipGraphs: typeof clipGraphs;
  clipJobs: typeof clipJobs;
  clipStorage: typeof clipStorage;
  communityChat: typeof communityChat;
  contentControl: typeof contentControl;
  contentIdeas: typeof contentIdeas;
  contentRewardMeasurements: typeof contentRewardMeasurements;
  controlPanel: typeof controlPanel;
  crons: typeof crons;
  describeVideo: typeof describeVideo;
  devTeamSchedule: typeof devTeamSchedule;
  devWipe: typeof devWipe;
  distributions: typeof distributions;
  documentaryProjects: typeof documentaryProjects;
  downloadCache: typeof downloadCache;
  downloadJobs: typeof downloadJobs;
  earnings: typeof earnings;
  economyReconcile: typeof economyReconcile;
  email: typeof email;
  health: typeof health;
  http: typeof http;
  influencers: typeof influencers;
  investments: typeof investments;
  jobApplications: typeof jobApplications;
  launchRuns: typeof launchRuns;
  leads: typeof leads;
  "lib/accountLookup": typeof lib_accountLookup;
  "lib/appFetch": typeof lib_appFetch;
  "lib/auth": typeof lib_auth;
  "lib/calloutTrade": typeof lib_calloutTrade;
  "lib/characterAgent": typeof lib_characterAgent;
  "lib/controlPanelValidators": typeof lib_controlPanelValidators;
  "lib/launchOptions": typeof lib_launchOptions;
  "lib/marketSummary": typeof lib_marketSummary;
  "lib/passwordAuth": typeof lib_passwordAuth;
  "lib/payments": typeof lib_payments;
  "lib/solanaVerify": typeof lib_solanaVerify;
  "lib/solstarAuth": typeof lib_solstarAuth;
  "lib/supabaseAuth": typeof lib_supabaseAuth;
  "lib/terminalStats": typeof lib_terminalStats;
  liveChat: typeof liveChat;
  "migrations/backfillHandleLower": typeof migrations_backfillHandleLower;
  "migrations/mergeClipforgeIntoFoundersClub": typeof migrations_mergeClipforgeIntoFoundersClub;
  mintFee: typeof mintFee;
  nftAgents: typeof nftAgents;
  nodeApplications: typeof nodeApplications;
  opsInterns: typeof opsInterns;
  oracle: typeof oracle;
  platformLaunch: typeof platformLaunch;
  platformStats: typeof platformStats;
  platformToken: typeof platformToken;
  referrals: typeof referrals;
  sampleRuns: typeof sampleRuns;
  scheduledContent: typeof scheduledContent;
  scheduledRecreations: typeof scheduledRecreations;
  seriesEpisodes: typeof seriesEpisodes;
  shareRedemptions: typeof shareRedemptions;
  shares: typeof shares;
  solstarBudget: typeof solstarBudget;
  solstarCatalog: typeof solstarCatalog;
  solstarChain: typeof solstarChain;
  solstarCreate: typeof solstarCreate;
  solstarDiscovery: typeof solstarDiscovery;
  solstarFeed: typeof solstarFeed;
  solstarFlywheel: typeof solstarFlywheel;
  solstarLiveCam: typeof solstarLiveCam;
  solstarMarket: typeof solstarMarket;
  solstarTrade: typeof solstarTrade;
  storageMigration: typeof storageMigration;
  studioGen: typeof studioGen;
  submissions: typeof submissions;
  tasteEvents: typeof tasteEvents;
  tournament: typeof tournament;
  transcriptCache: typeof transcriptCache;
  ugcSampleRuns: typeof ugcSampleRuns;
  usage: typeof usage;
  userCredits: typeof userCredits;
  userGenerations: typeof userGenerations;
  users: typeof users;
  videoJobArgs: typeof videoJobArgs;
  videoJobs: typeof videoJobs;
  videoJobsGenerate: typeof videoJobsGenerate;
  videoProgress: typeof videoProgress;
  videoRecreateProjects: typeof videoRecreateProjects;
  videoRenderJobs: typeof videoRenderJobs;
  withdrawals: typeof withdrawals;
  x402: typeof x402;
  xAccounts: typeof xAccounts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
