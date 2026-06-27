import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MasonryGrid, MasonryGridSkeleton } from '../components/MasonryGrid';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Crop } from 'react-image-crop';
import { apex } from '../lib/apex';
import { useAuth } from '../context/AuthContext';
import { getCroppedImg } from '../lib/imageUtils';
import { PinImageLens } from '../components/PinImageLens';
import { PinDetailsSection } from '../components/PinDetailsSection';
import 'react-image-crop/dist/ReactCrop.css';

export function PinDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLensMode, setIsLensMode] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<Crop | null>(null);
  const [isLoadingSimilar, setIsLoadingSimilar] = useState(false);
  const [isLoadingPin, setIsLoadingPin] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saveId, setSaveId] = useState<string | null>(null);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  const [pin, setPin] = useState<any>(null);
  const [similarPins, setSimilarPins] = useState<any[]>([]);
  
  // Fetch pin details
  useEffect(() => {
    const fetchPin = async () => {
      if (!id) return;
      setIsLoadingPin(true);
      try {
        const record = await apex.collection('pins').get(id, { expand: 'author_id' });
        const data = record.data || record;
        const authorObj = record.expand?.author_id;
        const authorRecord = Array.isArray(authorObj) ? authorObj[0] : authorObj;
        const authorData = (authorRecord?.data || authorRecord) || {};
        const pData = {
          id: record.id,
          title: data.title,
          description: data.description,
          author: authorData.name || 'Anonymous',
          authorHandle: authorData.handle || '@anonymous',
          authorAvatar: authorData.avatar ? apex.files.getFileUrl(authorData.avatar) : `https://api.dicebear.com/7.x/avataaars/svg?seed=${record.id}`,
          image: apex.files.getFileUrl(data.image),
          tags: data.tags || [],
          likes_count: data.likes_count || 0
        };
        setPin(pData);
        setLikesCount(pData.likes_count);

        // Check if saved & liked
        if (user) {
          const [savedList, likedList] = await Promise.all([
            apex.collection('saved_pins').list({
              filter: `user_id = "${user.id}" && pin_id = "${id}"`
            }).catch(() => ({ total: 0, items: [] })),
            apex.collection('likes').list({
              filter: `user_id = "${user.id}" && pin_id = "${id}"`
            }).catch(() => ({ total: 0, items: [] }))
          ]);
          
          if (savedList.total > 0) {
            setIsSaved(true);
            setSaveId(savedList.items[0].id);
          } else {
            setIsSaved(false);
            setSaveId(null);
          }

          if (likedList.total > 0) {
            setIsLiked(true);
          } else {
            setIsLiked(false);
          }
        }
      } catch (err) {
        console.error("Failed to fetch pin:", err);
      } finally {
        setIsLoadingPin(false);
      }
    };

    window.scrollTo(0, 0);
    setIsLensMode(false);
    setCrop(undefined);
    setCompletedCrop(null);
    fetchPin();
  }, [id]);

  // Fetch similar pins
  useEffect(() => {
    const fetchSimilar = async () => {
      if (!pin) return;
      setIsLoadingSimilar(true);
      try {
        let results: any[] = [];
        if (isLensMode && completedCrop && completedCrop.width && completedCrop.height) {
          // Visual search for specific cropped area
          try {
            const croppedImage = await getCroppedImg(pin.image, completedCrop);
            if (croppedImage) {
              results = await apex.collection('pins').searchImageVector(croppedImage, 15);
            } else {
              results = await apex.collection('pins').searchImageVector(pin.image, 15);
            }
          } catch (err) {
            console.error("Failed to crop image for search:", err);
            results = await apex.collection('pins').searchImageVector(pin.image, 15);
          }
        } else if (isLensMode) {
          // Visual search for whole image
          results = await apex.collection('pins').searchImageVector(pin.image, 15);
        } else {
          // Text search based on title for "More like this"
          results = await apex.collection('pins').searchTextVector(pin.title, 15);
        }

        const mapped = (results || [])
          .filter((r: any) => r && r.id !== pin.id)
          .map((r: any) => {
            const rData = r.data || r;
            return {
              id: r.id,
              image: apex.files.getFileUrl(rData.image, '300x0'),
              title: rData.title,
              author: rData.author || 'Anonymous',
              category: rData.category,
              height: rData.height || 300
            };
          });
        setSimilarPins(mapped);
      } catch (err) {
        console.error("Failed to fetch similar:", err);
      } finally {
        setIsLoadingSimilar(false);
      }
    };

    fetchSimilar();
  }, [pin, isLensMode, completedCrop]);

  const handleToggleLike = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setIsLiking(true);
    try {
      const { liked } = await apex.collection('pins').toggleLike(user.id, pin.id);
      setIsLiked(liked);
      setLikesCount(prev => liked ? prev + 1 : Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to toggle like:", err);
    } finally {
      setIsLiking(false);
    }
  };

  const handleToggleSave = async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setIsSaving(true);
    try {
      if (isSaved && saveId) {
        await apex.collection('saved_pins').delete(saveId);
        setIsSaved(false);
        setSaveId(null);
      } else {
        const res = await apex.collection('saved_pins').create({
          user_id: user.id,
          pin_id: pin.id
        });
        setIsSaved(true);
        setSaveId(res.id);
      }
    } catch (err) {
      console.error("Failed to toggle save:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const hasActiveCrop = crop?.width || completedCrop?.width;

  if (isLoadingPin) {
    return (
      <div className="max-w-7xl mx-auto py-12">
        <div className="animate-pulse flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-1/2 h-[600px] bg-surface rounded-3xl"></div>
          <div className="w-full md:w-1/2 space-y-4">
            <div className="h-10 bg-surface rounded w-3/4"></div>
            <div className="h-6 bg-surface rounded w-1/2"></div>
            <div className="h-32 bg-surface rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!pin) {
    return (
      <div className="max-w-7xl mx-auto py-20 text-center">
        <h2 className="text-2xl font-bold">Pin not found</h2>
        <Link to="/" className="text-neon mt-4 inline-block hover:underline">Return to home</Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Helmet>
        <title>{pin.title} | Vortex</title>
        <meta name="description" content={pin.description} />
        <meta property="og:title" content={pin.title} />
        <meta property="og:description" content={pin.description} />
        <meta property="og:image" content={pin.image} />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-ink-invert mb-6 transition-colors font-medium">
        <ArrowLeft size={20} />
        <span>Back to feed</span>
      </Link>

      <div className="bg-surface rounded-3xl overflow-hidden flex flex-col md:flex-row mb-16 border border-black/5 dark:border-white/5 shadow-2xl">
        {/* Image Section */}
        <PinImageLens
          image={pin.image}
          title={pin.title}
          isLensMode={isLensMode}
          setIsLensMode={setIsLensMode}
          crop={crop}
          setCrop={setCrop}
          completedCrop={completedCrop}
          setCompletedCrop={setCompletedCrop}
        />
        
        {/* Details Section */}
        <PinDetailsSection
          pin={pin}
          isLiked={isLiked}
          isLiking={isLiking}
          likesCount={likesCount}
          handleToggleLike={handleToggleLike}
          isSaved={isSaved}
          isSaving={isSaving}
          handleToggleSave={handleToggleSave}
        />
      </div>

      {/* Similar Images */}
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold">
          {isLensMode && hasActiveCrop ? 'Live matches for selected area' : 'More like this'}
        </h2>
      </div>
      
      {isLoadingSimilar ? (
        <MasonryGridSkeleton count={15} />
      ) : (
        <MasonryGrid pins={similarPins} />
      )}
    </div>
  );
}
