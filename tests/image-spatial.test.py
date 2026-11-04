import sys, unittest
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/modules/image/general'))
from spatial import full_image_distribution
class Constant:
    def __init__(self, score): self.score=score
    def predict(self, images, batch_size):
        assert batch_size==4
        assert all(i.size==(336,336) for i in images)
        return [{'fake_probability':self.score,'logit':0} for _ in images]
class SpatialTests(unittest.TestCase):
    def test_every_pixel_and_corner_covered_at_bounded_cost(self):
        for size in [(1024,1024),(2000,500),(500,2000),(100,80),(336,336),(337,600),(1,1000)]:
            with self.subTest(size=size):
                layer, result=full_image_distribution(Image.new('RGB',size),Constant(.8))
                coverage=np.zeros((size[1],size[0]),bool)
                for row in result['windows']:
                    x,y,r,b=row['sourceBox'];coverage[y:b,x:r]=True
                self.assertTrue(coverage.all());self.assertLessEqual(result['windowCount'],36)
                self.assertAlmostEqual(result['minimum'],.8,places=5)
                self.assertAlmostEqual(result['maximum'],.8,places=5)
                self.assertEqual(layer.size,tuple(result['analysisSize']))
    def test_fixed_scale_preserves_weak_and_strong(self):
        low,_=full_image_distribution(Image.new('RGB',(100,100)),Constant(.1))
        high,_=full_image_distribution(Image.new('RGB',(100,100)),Constant(.9))
        self.assertLess(low.getpixel((0,0))[0],high.getpixel((0,0))[0])
        self.assertLess(low.getpixel((0,0))[3],high.getpixel((0,0))[3])
    def test_invalid_score_rejected(self):
        with self.assertRaises(ValueError):full_image_distribution(Image.new('RGB',(10,10)),Constant(float('nan')))
if __name__=='__main__':unittest.main()
