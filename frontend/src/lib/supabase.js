import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://tlqiuafdtxrlaltedunk.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRscWl1YWZkdHhybGFsdGVkdW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjEzNzAsImV4cCI6MjA5NzAzNzM3MH0.m4aLXa_twd50sKNB3HBaFbOzYBdWDAMyfOhuRzdHJGo"
);
