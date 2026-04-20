'use strict';

const { chromium } = require('playwright');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const config = require('./config');

async function provisionXAccount(persona) {
    console.log(`[X Provisioning Engine] Initializing Headless Boot for ${persona.cloneName} (${persona.agentEmail})`);
    
    // We launch Playwright rigidly spoofing user-agent and mimicking standard viewpoint telemetry natively.
    const browser = await chromium.launch({
        headless: false, // Explicitly keep visible currently so we can visually debug the bot perimeter tests manually!
        args: [
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });
    
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        locale: 'en-US',
    });
    
    const page = await context.newPage();
    
    try {
        console.log('[X Provisioning Engine] Navigating deeply to explicit signup tunnel natively...');
        await page.goto('https://x.com/i/flow/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Let natural network settling occur (Bot countermeasure: fast inputs fail)
        await page.waitForTimeout(3500); 

        console.log('[X Provisioning Engine] Locating Create Account explicitly...');
        // Note: X changes DOM selectors dynamically. We strictly map based on Aria-roles where possible.
        // E.g. wait for input fields Name and Email Native
        
        // This is a placeholder payload map
        console.log('[X Provisioning Engine] Entering Persona Parameters natively...');
        
        // Intercept initial modal required by X natively
        await page.locator('[role="button"]:has-text("Create account")').click({ force: true });
        await page.waitForTimeout(1500);
        
        await page.fill('input[name="name"]', persona.base_name || 'Alfie');
        await page.waitForTimeout(500);
        
        // Switch to email toggle explicitly natively
        await page.locator(':has-text("Use email")').last().click({ force: true });
        await page.waitForTimeout(500);
        await page.fill('input[name="email"]', persona.agent_email || 'hello@test.com');
        
        // Map DOM Combobox Selectors for Date Of Birth bypassing X anti-bot flags
        const selects = page.getByRole('combobox');
        await selects.nth(0).selectOption({ index: 1 }); // Month: Jan
        await selects.nth(1).selectOption({ index: 1 }); // Day: 1
        await selects.nth(2).selectOption({ label: '1995' }); // Year: 1995
        
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /^Next$/i }).click({ force: true });
        
        // Intercept Customize your experience interstitial sequentially
        console.log('[X Provisioning Engine] Bypassing Web Tracking interstitial natively...');
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: /^Next$/i }).click({ force: true });
        
        // Finalize Account Summary pre-flight screen securely
        console.log('[X Provisioning Engine] Confirming Final Summary Payload dynamically...');
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: /^Sign up$/i }).click({ force: true });
        
        console.log('[X Provisioning Engine] Form explicitly populated. Pausing execution hook waiting for Hostinger Verification...');
        // Initialize IMAP Polling tightly hitting Hostinger natively
        const imapUser = String(process.env.HOSTINGER_IMAP_USER || '').trim();
        const imapPassword = String(process.env.HOSTINGER_IMAP_PASSWORD || '').trim();
        const imapHost = String(process.env.HOSTINGER_IMAP_HOST || '').trim();
        
        if (imapUser && imapPassword && imapHost) {
             console.log('[X Provisioning Engine] Waiting for Hostinger IMAP to catch the inbound PIN hook natively...');
             
             // IMAP Polling Loop Definition natively activated
             const imapConfig = {
                 imap: {
                     user: imapUser,
                     password: imapPassword,
                     host: imapHost,
                     port: 993,
                     tls: true,
                     authTimeout: 10000
                 }
             };
             
             try {
                 const connection = await imaps.connect(imapConfig);
                 await connection.openBox('INBOX');
                 
                 // Search for UNSEEN emails
                 const searchCriteria = ['UNSEEN'];
                 const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: false }; 
                 
                 console.log('[X Provisioning Engine] Initiating continuous polling loop for Hostinger mailbox...');
                 // Setting up a polling mechanism (check every 5 seconds, max 12 tries = 60s)
                 let verifyCode = null;
                 for (let attempt = 0; attempt < 12; attempt++) {
                     const results = await connection.search(searchCriteria, fetchOptions);
                     for (let res of results) {
                         const textPart = res.parts.find(p => p.which === 'TEXT');
                         if (textPart) {
                             const body = textPart.body;
                             // Extract 6 digit code natively (simple Regex parsing)
                             const pinMatch = body.match(/\b\d{6}\b/);
                             if (pinMatch) {
                                 verifyCode = pinMatch[0];
                                 console.log(`[X Provisioning Engine] Successfully parsed shadow PIN: ${verifyCode}`);
                                 // Enter the verification code dynamically into the popup
                                 await page.waitForTimeout(1000);
                                 await page.fill('input[name="verification_code"]', verifyCode);
                                 await page.waitForTimeout(500);
                                 await page.getByRole('button', { name: /^Next$/i }).click({ force: true });
                                 break;
                             }
                         }
                     }
                     if (verifyCode) break;
                     await new Promise(r => setTimeout(r, 5000));
                 }
                 
                 if (!verifyCode) {
                    console.log('[X Provisioning Engine] Timeline expired securely waiting for Hostinger Verification Code.');
                 }
                 
                 connection.end();
             } catch (err) {
                 console.error('[X Provisioning Engine] IMAP Polling failed: ', err);
             }
        } else {
             console.log('[X Provisioning Engine] SKIPPED IMAP Polling: Missing Hostinger credentials explicitly in environment files!');
        }

        // For development, keeping browser open for testing perimeter validation manually!
        // await browser.close();
        return { ok: true, step: 'form_populated' };

    } catch (err) {
        console.error('[X Provisioning Engine] Headless robotic sequence failed cleanly:', err.message);
        await browser.close();
        return { ok: false, error: err.message };
    }
}

module.exports = {
   provisionXAccount
};
