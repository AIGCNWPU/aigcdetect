import unittest
from evaluate_results import ranking_metrics,prediction,summarize,wilson
from evaluate_cord import overlap,contains_word,evaluate
class EvaluationTests(unittest.TestCase):
    def test_ranking_ties(self):
        self.assertEqual(ranking_metrics([0,1],[.5,.5]),{'roc_auc':.5,'average_precision':.5})
        self.assertEqual(ranking_metrics([0,1],[.1,.9]),{'roc_auc':1.,'average_precision':1.})
        self.assertEqual(ranking_metrics([0,1],[.9,.1]),{'roc_auc':0.,'average_precision':.5})
    def test_invalid_and_missing_stay_in_denominator(self):
        r=summarize([{'label':0,'status':'succeeded','generated_score':.1},{'label':1,'status':'failed'},{'label':1,'status':'not_run'}],'mirror')
        self.assertEqual(r['accuracy_on_valid'],1);self.assertEqual(r['correct_fraction_of_all_inputs'],1/3);self.assertEqual(r['failed_or_unparsed'],2)
    def test_contradictory_truncated_conclusions_rejected(self):
        for text in ('AUTHENTIC','[Conclusion]: AUTHENTIC\n[Conclusion]: FORGED'):
            self.assertIsNone(prediction({'status':'succeeded','raw_output':text},'docshield'))
        self.assertEqual(prediction({'status':'succeeded','raw_output':'[Conclusion]: FORGED'},'docshield'),1)
        self.assertIsNone(prediction({'status':'succeeded','raw_output':'[Conclusion]: FORGED','token_limit_reached':True},'docshield'))
    def test_wilson_empty_and_zero(self):
        self.assertIsNone(wilson(0,0));self.assertGreater(wilson(0,10)[1],0)
    def test_retrieval_preserves_digits_punctuation_and_case(self):
        self.assertFalse(contains_word('1','100'));self.assertFalse(contains_word('1','1.00'));self.assertFalse(contains_word('60','-60'));self.assertFalse(contains_word('000','60.000'));self.assertFalse(contains_word('1.00','1,00'));self.assertFalse(contains_word('TOTAL','Total'))
        self.assertTrue(contains_word('-TICKET','-TICKET CP'));self.assertTrue(contains_word('CP','-TICKET CP'));self.assertTrue(contains_word('60.000','TOTAL 60.000'));
        self.assertFalse(contains_word('60.000','60,000'));self.assertFalse(contains_word('TOTAL','SUBTOTAL'));
        self.assertTrue(contains_word('60.000','TOTAL: 60.000'));self.assertFalse(contains_word('60.000','160.000'))
    def test_spatial_anchor_not_whole_page_match(self):
        self.assertEqual(overlap([[0,0],[10,0],[10,10],[0,10]],[[20,0],[30,0],[30,10],[20,10]]),0)
        q={'x1':0,'y1':0,'x2':10,'y2':0,'x3':10,'y3':10,'x4':0,'y4':10}
        gt=[{'sample_id':'a','annotation':{'valid_line':[{'category':'total','words':[{'text':'100','quad':q}]}]}}]
        r=evaluate(gt,{'a':{'status':'failed','regions':[]}})
        self.assertEqual(r['groups']['all']['words'],1);self.assertEqual(r['groups']['all']['retrieved'],0)
if __name__=='__main__':unittest.main()
