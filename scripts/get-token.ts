// scripts/get-token.ts
// Helper script to get a Supabase JWT token for extension development
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
    const args = process.argv.slice(2);
    const mode = args[0]; // 'login' or 'signup'
    const email = args[1];
    const password = args[2];

    if (!mode || !email || !password) {
        console.log("Usage: npx tsx scripts/get-token.ts <login|signup> <email> <password>");
        process.exit(1);
    }

    if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
            console.error("❌ Signup error:", error.message);
            process.exit(1);
        }
        console.log("✅ Signup successful! Please check your email for confirmation (if enabled).");
        if (data.session) {
            console.log("\nJWT Token:");
            console.log(data.session.access_token);
        }
    } else if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            console.error("❌ Login error:", error.message);
            process.exit(1);
        }
        if (data.session) {
            console.log("✅ Login successful!");
            console.log("\nJWT Token:");
            console.log(data.session.access_token);
        } else {
            console.log("❌ Login successful but no session found (check email confirmation).");
        }
    } else {
        console.error("❌ Invalid mode. Use 'login' or 'signup'.");
    }
}

main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
