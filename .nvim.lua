vim.api.nvim_create_autocmd({ "BufEnter" }, {
	pattern = { "*.html" },
	callback = function(ev)
		vim.bo.filetype = "htmldjango"
	end,
})

require("conform").formatters.sqlfluff.args = { "format", "--dialect=sqlite", "-" }

require("lint").linters.sqlfluff.args = { "lint", "--format=json", "--dialect=sqlite", "-" }
