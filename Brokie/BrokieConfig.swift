import Foundation

/// Your Supabase project. Both values are public by design (the anon key only
/// grants what the database's permissions allow). Leave them empty to play the
/// offline practice mode only.
enum BrokieConfig {
    static let supabaseURL = "https://nchvildidonrzoipktjw.supabase.co"
    static let supabaseAnonKey = "sb_publishable_gSY6z7Bi2AzpPOjJSTWYkQ_GVJQD4Kc"

    static var isConfigured: Bool {
        guard let url = URL(string: supabaseURL), url.scheme == "https", url.host != nil else { return false }
        return !supabaseAnonKey.isEmpty
    }
}
