import UIKit

final class ErrorOverlay: UIView {
    var retry: (() -> Void)?

    init(error: NSError, url: URL) {
        super.init(frame: .zero)
        backgroundColor = ThemeColor.initial.uiColor
        accessibilityIdentifier = "loadErrorOverlay"
        let title = UILabel()
        title.text = "无法加载页面"
        title.font = .preferredFont(forTextStyle: .title2)
        title.textColor = .white
        let detail = UILabel()
        detail.text = "\(error.localizedDescription)\n\n\(url.absoluteString)\n\n\(error.domain) (\(error.code))"
        detail.font = .preferredFont(forTextStyle: .body)
        detail.textColor = UIColor(white: 0.85, alpha: 1)
        detail.numberOfLines = 0
        detail.accessibilityIdentifier = "loadErrorDetail"
        let button = UIButton(type: .system)
        button.setTitle("重试", for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.accessibilityIdentifier = "retryLoad"
        button.addAction(UIAction { [weak self] _ in self?.retry?() }, for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, detail, button])
        stack.axis = .vertical
        stack.spacing = 20
        addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor)
        ])
        for label in [title, detail] { label.adjustsFontForContentSizeCategory = true }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
