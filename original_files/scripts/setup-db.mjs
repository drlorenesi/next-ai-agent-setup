// scripts/create-db.js
import { config } from "dotenv"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import readline from "readline"
import pg from "pg"

// Load environment variables from .env file
config()

const { Client } = pg

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Function to prompt user for confirmation
export async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.toLowerCase().trim())
    })
  })
}

async function createDatabase() {
  // Check for DATABASE_URL environment variable
  if (!process.env.DATABASE_URL) {
    console.error("❌ Error: DATABASE_URL environment variable is not set")
    console.log("💡 Please add your Neon database URL to your .env file:")
    console.log(
      '   DATABASE_URL="postgresql://user:password@host/database?sslmode=require"'
    )
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Neon requires SSL
    },
  })

  try {
    console.log("🔌 Connecting to database...")
    await client.connect()
    console.log("✅ Connected successfully")

    // Read the schema file
    console.log("📖 Reading schema file...")
    // Change to the correct path dependind on databese type
    const schemaPath = join(__dirname, "..", "./db/schema_pg.sql")
    const schema = readFileSync(schemaPath, "utf-8")

    // Execute the schema
    console.log("🚀 Creating tables and indexes...")
    await client.query(schema)

    console.log("✅ Database schema created successfully!")
    console.log("\n📊 Tables created:")
    console.log("   - user")
    console.log("   - session")
    console.log("   - account")
    console.log("   - verification")
    console.log("\n🎯 Indexes and triggers created successfully")
  } catch (error) {
    console.error("❌ Error creating database schema:", error.message)
    console.error("\nFull error details:", error)
    process.exit(1)
  } finally {
    await client.end()
    console.log("🔌 Database connection closed")
  }
}

// Run the script
createDatabase()
