$('.single_toggle').html();
var faqArray = [];
$('.av_toggle_section').each(function () {
	var que = $(this).find('.toggler').text();
	var ans = $(this).find('.toggle_content').html();

	// Stripping HTML tags from ans
	ans = ans.replace(/<\/?[^>]+(>|$)/g, '');
	// console.log(que);
	// console.log(ans);
	faqArray.push({
		question: que,
		answer: ans,
	});
});

var json = {
	'@context': 'https://schema.org',
	'@type': 'FAQPage',
	mainEntity: [],
};

var blogFaqs = faqArray;

blogFaqs.forEach(function (item, index) {
	json.mainEntity.push({
		'@type': 'Question',
		name: item.question.replace(/<\/?[^>]+(>|$)/g, ''),
		acceptedAnswer: {
			'@type': 'Answer',
			text: item.answer, // Assuming parseTextEditor function is defined
		},
	});
});

var script = `<script type="application/ld+json">`;
var html = script;
html += JSON.stringify(json);
html += '</script>';
console.log(json);
$('.togglecontainer').append(html);
