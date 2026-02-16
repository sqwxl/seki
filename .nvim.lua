vim.api.nvim_create_autocmd({ "BufEnter" }, {
	pattern = { "*.html" },
	callback = function(ev)
		vim.bo.filetype = "htmldjango"
	end,
})
