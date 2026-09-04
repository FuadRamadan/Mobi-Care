import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, Dimensions, Pressable, NativeSyntheticEvent, NativeScrollEvent, Linking, Text } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import { useColors } from '@/hooks/useColors';
import { PublicAdvertisement, useListAdvertisements, getListAdvertisementsQueryKey } from '@workspace/api-client-react';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Parent list has paddingHorizontal: 16, so available width is SCREEN_WIDTH - 32
const SLIDE_WIDTH = SCREEN_WIDTH - 32;
// Standard ad aspect ratio ~ 16:9
const AD_HEIGHT = SLIDE_WIDTH * (9 / 16);

function AdVideoItem({ item, isActive }: { item: PublicAdvertisement, isActive: boolean }) {
  const source = `https://${process.env.EXPO_PUBLIC_DOMAIN}${item.mediaUrl}`;
  
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    if (isActive) {
      p.play();
    }
  });

  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, player]);

  return (
    // @ts-expect-error React 19 JSX types mismatch
    <VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} />
  );
}

function AdItem({ item, isActive }: { item: PublicAdvertisement, isActive: boolean }) {
  const colors = useColors();
  const handlePress = async () => {
    if (item.linkUrl) {
      try {
        if (item.linkUrl.startsWith('http')) {
          await WebBrowser.openBrowserAsync(item.linkUrl);
        } else {
          await Linking.openURL(item.linkUrl);
        }
      } catch (e) {
        // Silently fail if link cannot be opened
      }
    }
  };

  const isVideo = item.mediaKind === 'video';

  return (
    <Pressable 
      onPress={handlePress}
      style={[styles.itemContainer, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityRole={item.linkUrl ? "button" : "image"}
      accessibilityLabel={item.alt || item.title || "Advertisement"}
      testID={`ad-item-${item.id}`}
    >
      {isVideo ? (
        <AdVideoItem item={item} isActive={isActive} />
      ) : (
        // @ts-expect-error React 19 JSX types mismatch
        <Image 
          source={{ uri: `https://${process.env.EXPO_PUBLIC_DOMAIN}${item.mediaUrl}` }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          accessibilityLabel={item.alt || undefined}
        />
      )}
      
      {item.caption ? (
        <View style={[styles.captionContainer, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Text style={styles.captionText} numberOfLines={1}>{item.caption}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function AdCarousel() {
  const colors = useColors();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  
  const { data: ads } = useListAdvertisements({
    query: {
      queryKey: getListAdvertisementsQueryKey()
    }
  });

  // Auto-advance
  useEffect(() => {
    if (!ads || ads.length <= 1 || isPaused) return;

    const timer = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % ads.length;
        flatListRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [ads, isPaused]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const slideSize = e.nativeEvent.layoutMeasurement.width;
    // ensure we don't divide by 0
    if (slideSize <= 0) return;
    const index = e.nativeEvent.contentOffset.x / slideSize;
    setActiveIndex(Math.round(index));
  }, []);

  if (!ads || ads.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={ads}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setIsPaused(true)}
        onScrollEndDrag={() => setIsPaused(false)}
        renderItem={({ item, index }) => (
          <View style={styles.slideWrapper}>
            <AdItem item={item} isActive={index === activeIndex} />
          </View>
        )}
      />
      
      {ads.length > 1 && (
        <View style={styles.pagination}>
          {ads.map((_, i) => (
            <View 
              key={i} 
              style={[
                styles.dot, 
                { backgroundColor: i === activeIndex ? colors.primary : colors.border },
                i === activeIndex && { width: 16 }
              ]} 
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
    width: SLIDE_WIDTH,
  },
  slideWrapper: {
    width: SLIDE_WIDTH,
  },
  itemContainer: {
    width: SLIDE_WIDTH,
    height: AD_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  captionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  captionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  }
});
