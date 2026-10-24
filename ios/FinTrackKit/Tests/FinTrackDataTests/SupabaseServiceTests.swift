import Foundation
import Testing
@testable import FinTrackData
import Supabase

@Suite("oturum yardımcıları")
struct SessionHelperTests {
    private func jwt(_ claims: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: claims)
        let body = data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "eyJhbGciOiJIUzI1NiJ9.\(body).imza"
    }

    @Test func aalIddiasiOkunur() {
        #expect(SupabaseService.assuranceLevel(jwt(["aal": "aal2", "sub": "u"])) == "aal2")
        #expect(SupabaseService.assuranceLevel(jwt(["aal": "aal1"])) == "aal1")
        #expect(SupabaseService.assuranceLevel(jwt(["sub": "u"])) == nil)
        #expect(SupabaseService.assuranceLevel("bozuk") == nil)
    }

    @Test func uuidDogrulamasi() {
        #expect(SupabaseService.isUUID("3f2a8c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b"))
        #expect(!SupabaseService.isUUID("x\"),user_id.neq.(y"))
        #expect(!SupabaseService.isUUID(""))
    }

    @Test func agHatasiTanınır() {
        #expect(SupabaseService.isNetworkError(URLError(.notConnectedToInternet)))
        #expect(SupabaseService.isNetworkError(NSError(domain: NSURLErrorDomain, code: -1009)))
        #expect(!SupabaseService.isNetworkError(NSError(domain: "auth", code: 400)))
    }
}

@Suite("yazma hatası sınıfları")
struct WriteErrorTests {
    private func http(_ code: Int) -> HTTPError {
        HTTPError(data: Data(), response: HTTPURLResponse(url: URL(string: "https://x")!, statusCode: code,
                                                          httpVersion: nil, headerFields: nil)!)
    }

    @Test func kaliciVeGecici() {
        #expect(SupabaseService.isPermanentWriteError(PostgrestError(code: "23502", message: "not null")))
        #expect(SupabaseService.isPermanentWriteError(PostgrestError(code: "22P02", message: "invalid input")))
        #expect(SupabaseService.isPermanentWriteError(PostgrestError(code: "PGRST102", message: "bad body")))
        #expect(!SupabaseService.isPermanentWriteError(PostgrestError(code: "42501", message: "rls")))
        #expect(!SupabaseService.isPermanentWriteError(http(503)))
        #expect(!SupabaseService.isPermanentWriteError(http(429)))
        #expect(!SupabaseService.isPermanentWriteError(URLError(.timedOut)))
    }

    @Test func yetki() {
        #expect(SupabaseService.isAuthError(PostgrestError(code: "42501", message: "rls")))
        #expect(SupabaseService.isAuthError(PostgrestError(code: "PGRST301", message: "jwt")))
        #expect(SupabaseService.isAuthError(http(401)))
        #expect(!SupabaseService.isAuthError(PostgrestError(code: "23505", message: "dup")))
    }
}
