import FinTrackCore

/// SwiftUI'nin `Transaction` (animasyon işlemi) türüyle çakışmasın: uygulamada
/// `Transaction` her zaman bir finans işlemidir.
typealias Transaction = FinTrackCore.Transaction
typealias Category = FinTrackCore.Category
