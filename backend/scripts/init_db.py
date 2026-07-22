import os
import sys
from dotenv import load_dotenv

# Ensure we can import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.init_supabase import init_supabase_schema

def main():
    load_dotenv()
    db_url = os.getenv("DATABASE_URL")
    
    if not db_url:
        print("DATABASE_URL not found in .env file.")
        print("Please set DATABASE_URL to your Supabase PostgreSQL connection string.")
        print("Example: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres")
        db_url = input("Enter DATABASE_URL now (or press Enter to exit): ").strip()
        
        if not db_url:
            print("Exiting.")
            sys.exit(1)
            
    print(f"Connecting to database...")
    success = init_supabase_schema(db_url)
    if success:
        print("✅ Database initialized successfully!")
    else:
        print("❌ Failed to initialize database.")
        sys.exit(1)

if __name__ == "__main__":
    main()
